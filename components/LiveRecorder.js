import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload strategy: browser → AssemblyAI directly (Vercel never sees the blob)
//
// 1. GET /api/aai-token  → server mints a one-time AssemblyAI upload URL
// 2. Browser PUTs blob straight to that URL (no Vercel in the path)
// 3. POST /api/transcribe with { upload_url } → tiny JSON, server polls + returns transcript
// ─────────────────────────────────────────────────────────────────────────────

async function safeJson(res, label) {
  // If the server returns plain text (e.g. Vercel's "Request Entity Too Large")
  // instead of JSON, this surfaces the actual message rather than the cryptic
  // "Unexpected token 'R'" parse error.
  if (!res.ok) {
    let text;
    try { text = await res.text(); } catch { text = `HTTP ${res.status}`; }
    throw new Error(`[${label}] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return await res.json();
  } catch {
    let text;
    try { text = await res.text(); } catch { text = `HTTP ${res.status}`; }
    throw new Error(`[${label}] Non-JSON response: ${text.slice(0, 300)}`);
  }
}

async function transcribeBlob(blob, onProgress) {
  // ── Step 1: get a one-time upload URL from our server ────────────────────
  onProgress?.('Preparing upload…');
  const tokenRes = await fetch('/api/aai-token');
  const tokenData = await safeJson(tokenRes, 'aai-token');
  if (!tokenData.upload_url) {
    throw new Error('[aai-token] No upload_url in response');
  }

  // ── Step 2: PUT blob directly from browser to AssemblyAI ─────────────────
  // This goes browser → AssemblyAI — Vercel is not in the path at all.
  onProgress?.('Uploading audio…');
  const uploadRes = await fetch(tokenData.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const uploadData = await safeJson(uploadRes, 'assemblyai-upload');
  const audioUrl = uploadData.upload_url || uploadData.audio_url || uploadData.url;
  if (!audioUrl) {
    throw new Error('[assemblyai-upload] No audio URL in response: ' + JSON.stringify(uploadData));
  }

  // ── Step 3: transcribe via our server (sends only a short JSON body) ──────
  onProgress?.('Transcribing… please wait');
  const transcribeRes = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_url: audioUrl }),
  });
  const data = await safeJson(transcribeRes, 'transcribe');
  if (data.error) throw new Error(`[transcribe] ${data.error}`);
  if (data.status !== 'completed' || !data.transcript) {
    throw new Error('[transcribe] Returned empty result');
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
        // The error message now includes a [step-name] prefix so you can see
        // exactly which fetch failed, e.g. "[aai-token] HTTP 413: Request En..."
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