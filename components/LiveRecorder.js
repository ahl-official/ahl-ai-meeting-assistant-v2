import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';
import { decodeAudioFile, splitAudioBufferIntoWavChunks, sleep, buildSrtFromResults } from '../lib/audio-processor';

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
  const [srt, setSrt] = useState('');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

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
      setUploadProgress(0);
      const mime = getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mime });

      try {
        // Use robust chunking logic for live recordings too
        const audioBuffer = await decodeAudioFile(blob);
        const chunks = await splitAudioBufferIntoWavChunks(audioBuffer, 30);
        const totalChunks = chunks.length;
        const results = [];

        for (let i = 0; i < chunks.length; i++) {
          setUploadProgress(Math.round(((i) / totalChunks) * 100));

          const uploadRes = await fetch('/api/transcribe-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunks[i].blob,
          });

          if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(errText || `Upload error ${uploadRes.status}`);
          }

          const uploadData = await uploadRes.json();
          const transcriptId = uploadData.id;

          let completed = false;
          let chunkResult = null;
          while (!completed) {
            await sleep(3000);
            const statusRes = await fetch(`/api/transcript-status?id=${transcriptId}`);
            if (!statusRes.ok) {
              const errText = await statusRes.text();
              throw new Error(errText || `Poll error ${statusRes.status}`);
            }
            chunkResult = await statusRes.json();

            if (chunkResult.status === 'completed') {
              completed = true;
            } else if (chunkResult.status === 'error') {
              throw new Error(chunkResult.error || 'Transcription error');
            }
          }

          chunkResult.offsetMs = chunks[i].startMs;
          results.push(chunkResult);

          setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
        }

        const combinedTranscript = results.map(r => r.transcript).join(' ').trim();
        const combinedSrt = buildSrtFromResults(results);

        setTranscript(combinedTranscript);
        setSrt(combinedSrt);

        onTranscriptUpdate?.(combinedTranscript);
        onComplete?.(combinedTranscript, durationRef.current, combinedSrt);

        setState('stopped');

      } catch (err) {
        console.error(err);
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
          <div className={styles.recording} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="spinner" style={{ marginRight: 8 }} />
              <span>Transcribing ({uploadProgress}%)... please wait</span>
            </div>
            <div style={{ width: '100%', height: 4, background: 'var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--blue)', transition: 'width 0.3s ease' }} />
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
