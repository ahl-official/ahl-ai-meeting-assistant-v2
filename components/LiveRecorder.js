import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Vercel serverless functions cap request bodies at ~4.5 MB.
// We use 2 MB as our threshold to give a safe margin for framing overhead.
// Blobs above this go through /api/aai-upload (Edge, no body limit) first,
// which returns an AssemblyAI upload_url we hand to /api/transcribe as JSON.
// Small blobs go directly to /api/transcribe as a binary octet stream.
// The API key never leaves the server in either path.

const LARGE_AUDIO_THRESHOLD = 2 * 1024 * 1024; // 2 MB — safe margin below Vercel's 4.5 MB limit

async function safeJson(res) {
  // Guard against Vercel infrastructure errors (413, 502, etc.) that return
  // plain-text bodies like "Request Entity Too Large" instead of JSON.
  // Without this, res.json() throws "Unexpected token 'R'…" which is opaque.
  let data;
  try {
    data = await res.json();
  } catch {
    let text;
    try { text = await res.text(); } catch { text = `HTTP ${res.status}`; }
    throw new Error(text.slice(0, 300));
  }
  return data;
}

async function transcribeBlob(blob, onProgress) {
  let transcribeBody;
  let transcribeHeaders;

  if (blob.size > LARGE_AUDIO_THRESHOLD) {
    // ── Large file: two-step path via Edge proxy ──────────────────────────
    // Step 1: stream the raw blob to our Edge function which forwards it to
    // AssemblyAI's /v2/upload endpoint and returns { upload_url }.
    onProgress?.('Uploading audio…');

    const uploadRes = await fetch('/api/aai-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    });

    const uploadData = await safeJson(uploadRes);
    if (!uploadRes.ok || !uploadData.upload_url) {
      throw new Error(uploadData.error || `Upload failed (${uploadRes.status})`);
    }

    // Step 2: pass the remote URL to /api/transcribe so it never touches the blob
    transcribeBody = JSON.stringify({ upload_url: uploadData.upload_url });
    transcribeHeaders = { 'Content-Type': 'application/json' };
  } else {
    // ── Small file: single-step binary path ───────────────────────────────
    transcribeBody = blob;
    transcribeHeaders = { 'Content-Type': 'application/octet-stream' };
  }

  onProgress?.('Transcribing… please wait');

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: transcribeHeaders,
    body: transcribeBody,
  });

  const data = await safeJson(res);

  if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
  if (data.status !== 'completed' || !data.transcript) {
    throw new Error('Transcription returned empty result');
  }

  return data; // { transcript, srt, chunks }
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

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current?.stop();
  };

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

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

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
              {uploadProgress && (
                <span style={{ fontSize: 12, opacity: 0.7 }}>{uploadProgress}</span>
              )}
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