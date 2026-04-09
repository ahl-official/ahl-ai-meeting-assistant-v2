import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export default function LiveRecorder({ onTranscriptUpdate, onComplete }) {
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [duration, setDuration] = useState(0);
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

    recorder.onstop = async () => {
      setState('transcribing');
      const mimeType = getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });

      try {
        // Step 1: submit job
        const submitRes = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: blob,
        });
        const submitData = await submitRes.json();
        if (submitData.error) throw new Error(submitData.error);

        const { id } = submitData;

        // Step 2: poll from frontend every 3 seconds
        const poll = async () => {
          try {
            const statusRes = await fetch(`/api/transcript-status?id=${id}`);
            const data = await statusRes.json();

            if (data.status === 'completed') {
              setTranscript(data.transcript);
              onTranscriptUpdate?.(data.transcript);
              onComplete?.(data.transcript, durationRef.current);
              setState('stopped');
            } else if (data.status === 'error') {
              throw new Error(data.error || 'Transcription failed');
            } else {
              // still processing (queued or processing)
              setTimeout(poll, 3000);
            }
          } catch (err) {
            setError(`Transcription failed: ${err.message}`);
            setState('idle');
          }
        };

        poll();
      } catch (err) {
        setError(`Transcription failed: ${err.message}`);
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
            <span>Transcribing… please wait</span>
          </div>
        )}
        {state === 'stopped' && (
          <div className={styles.stopped}>
            <span className="badge badge-green">✓ Done — {fmt(duration)}</span>
            <button className={'btn btn-ghost'} onClick={() => {
              setState('idle');
              setTranscript('');
              durationRef.current = 0;
              setDuration(0);
            }}>
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