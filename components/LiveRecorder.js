import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// ── Upload helpers ────────────────────────────────────────────
// Vercel serverless functions cap request bodies at 4.5 MB.
// For blobs above this threshold we stream through /api/aai-upload
// (an Edge function with no body-size limit) to get an AssemblyAI
// upload_url, then hand only that URL to /api/transcribe.
// Small blobs go directly to /api/transcribe as before.
// Either way the API key never leaves the server.

// ── constants ────────────────────────────────────────────────
const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB — safely under 4.5 MB edge limit

// ── split a Blob into ordered chunks ─────────────────────────
function splitBlob(blob) {
  const chunks = [];
  let offset = 0;
  while (offset < blob.size) {
    chunks.push(blob.slice(offset, offset + CHUNK_SIZE));
    offset += CHUNK_SIZE;
  }
  return chunks;
}

// ── upload one chunk to AssemblyAI via your edge proxy ───────
async function uploadChunk(chunk) {
  const res = await fetch('/api/aai-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk,
  });
  const data = await res.json();
  if (!res.ok || !data.upload_url) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data.upload_url;
}

// ── transcribe one upload_url via your serverless route ──────
async function transcribeUploadUrl(upload_url) {
  const res = await fetch('/api/transcribe-chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_url }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Transcribe error ${res.status}`);
  return data; // { text, utterances, words }
}

// ── main entry: replaces old transcribeBlob ──────────────────
async function transcribeBlob(blob, onProgress) {
  const chunks = splitBlob(blob);
  const total = chunks.length;
  const results = [];

  for (let i = 0; i < total; i++) {
    onProgress?.(`Uploading part ${i + 1} of ${total}…`);
    const upload_url = await uploadChunk(chunks[i]);

    onProgress?.(`Transcribing part ${i + 1} of ${total}…`);
    const result = await transcribeUploadUrl(upload_url);
    results.push({ ...result, chunkIndex: i, offsetMs: i * 180000 });
    // 180000ms = 3MB ≈ ~3min of audio at 128kbps — adjust if needed
  }

  onProgress?.('Merging results…');
  return mergeChunkResults(results);
}

// ── merge ordered chunk results into final transcript + SRT ──
function mergeChunkResults(results) {
  const ordered = results.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const transcript = ordered
    .map(r => (r.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const srt = buildSrtFromChunks(ordered); // reuse your existing SRT builder
  return { transcript, srt, chunks: ordered.length };
}

export default function LiveRecorder({ onTranscriptUpdate, onComplete }) {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [srt, setSrt] = useState('');
  const [duration, setDuration] = useState(0);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const durationRef = useRef(0);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const startRecording = async () => {
    setError('');
    setTranscript('');
    setSrt('');
    setUploadProgress('');
    chunksRef.current = [];
    setState('recording');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      setState('idle');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Allow microphone in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect one and try again.');
      } else {
        setError(`Microphone error: ${err.message}`);
      }
      return;
    }

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = (e) => {
      setError(`Recording error: ${e.error}`);
    };

    recorder.onstop = async () => {
      setState('transcribing');

      if (chunksRef.current.length === 0) {
        setError('No audio recorded. Please try again.');
        setState('idle');
        return;
      }

      const mime = getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mime });

      if (blob.size === 0) {
        setError('Recording is empty (0 bytes). Microphone may not be working.');
        setState('idle');
        return;
      }

      try {
        const data = await transcribeBlob(blob, (msg) => setUploadProgress(msg));

        setTranscript(data.transcript);
        if (data.srt) setSrt(data.srt);
        setUploadProgress('');

        onTranscriptUpdate?.(data.transcript);
        onComplete?.(data.transcript, durationRef.current, data.srt);

        setState('stopped');
      } catch (err) {
        setError(`Transcription failed: ${err.message}`);
        setUploadProgress('');
        setState('idle');
      }
    };

    recorder.start(1000);
    durationRef.current = 0;
    setDuration(0);
    timerRef.current = setInterval(() => {
      durationRef.current += 1;
      setDuration(durationRef.current);
    }, 1000);
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current?.stop();
  };

  // ── SRT download helper ────────────────────────────────────
  const downloadSRT = () => {
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recording-transcript.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRecordAgain = () => {
    setState('idle');
    setTranscript('');
    setSrt('');
    durationRef.current = 0;
    setDuration(0);
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <div className={styles.recorder}>
      <div className={styles.controls}>
        {state === 'idle' && (
          <button className={'btn btn-primary ' + styles.recBtn} onClick={startRecording}>
            🎙 Start Recording
          </button>
        )}

        {state === 'recording' && (
          <div className={styles.recording}>
            <div className={styles.recIndicator}>
              <span className="rec-dot" />
              <span className={styles.recLabel}>Recording</span>
              <span className={styles.timer}>{fmt(duration)}</span>
            </div>
            <button className={'btn btn-danger'} onClick={stopRecording}>
              ⏹ Stop
            </button>
          </div>
        )}

        {state === 'transcribing' && (
          <div className={styles.recording}>
            <span className="spinner" style={{ marginRight: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Transcribing… please wait</span>
              {uploadProgress && <span style={{ fontSize: 12, opacity: 0.7 }}>{uploadProgress}</span>}
            </div>
          </div>
        )}

        {state === 'stopped' && (
          <div className={styles.stopped}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-green">✓ Done — {fmt(duration)}</span>
              {srt && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, padding: '4px 12px' }}
                  onClick={downloadSRT}
                >
                  ↓ Download .srt
                </button>
              )}
            </div>
            <button className={'btn btn-ghost'} onClick={handleRecordAgain}>
              Record again
            </button>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {state === 'stopped' && transcript && (
        <div className={styles.liveTranscript}>
          <span className={styles.liveLabel}>Transcript</span>
          <div className={styles.transcriptText}>{transcript}</div>
        </div>
      )}
    </div>
  );
}