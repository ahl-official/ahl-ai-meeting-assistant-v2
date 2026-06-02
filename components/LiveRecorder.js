import { useState, useRef, useEffect } from 'react';
import styles from '../styles/LiveRecorder.module.css';

const RECORDING_SEGMENT_MS = 45 * 1000;

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function formatSrtTime(ms) {
  const totalMs = Math.max(0, Math.floor(ms));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const mil = totalMs % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mil, 3)}`;
}

function speakerPrefix(speaker) {
  if (speaker === undefined || speaker === null || speaker === '') return '';
  const n = Number(speaker);
  return Number.isFinite(n) ? `Speaker ${n + 1}: ` : `Speaker ${String(speaker)}: `;
}

function buildCuesFromUtterances(utterances, offsetMs) {
  if (!Array.isArray(utterances) || !utterances.length) return [];
  return utterances
    .filter(u => u && typeof u.text === 'string' && u.text.trim())
    .map(u => {
      const startMs = (Number(u.start) || 0) + offsetMs;
      const endMs = (Number(u.end) || Number(u.start) || 0) + offsetMs;
      return {
        startMs,
        endMs: Math.max(endMs, startMs + 800),
        text: `${speakerPrefix(u.speaker)}${u.text.trim()}`,
      };
    });
}

function buildCuesFromWords(words, offsetMs) {
  if (!Array.isArray(words) || !words.length) return [];
  const cues = [];
  let buffer = [], cueStart = null, cueEnd = null;

  const flush = () => {
    if (!buffer.length || cueStart === null) return;
    cues.push({
      startMs: cueStart,
      endMs: Math.max(cueEnd, cueStart + 800),
      text: buffer.join(' ').trim(),
    });
    buffer = [];
    cueStart = null;
    cueEnd = null;
  };

  for (const w of words) {
    const text = String(w.text || '').trim();
    if (!text) continue;
    const startMs = (Number(w.start) || 0) + offsetMs;
    const endMs = (Number(w.end) || Number(w.start) || 0) + offsetMs;
    if (cueStart === null) cueStart = startMs;
    cueEnd = endMs;
    buffer.push(text);
    if (/[.?!]$/.test(text) || buffer.length >= 12 || cueEnd - cueStart >= 4500) flush();
  }
  flush();
  return cues;
}

function buildSrtFromChunks(chunkResults) {
  const cues = [];
  for (const chunk of chunkResults) {
    const offsetMs = Number(chunk.offsetMs) || 0;
    const utterances = Array.isArray(chunk.utterances) ? chunk.utterances : [];
    const words = Array.isArray(chunk.words) ? chunk.words : [];

    if (utterances.length) {
      cues.push(...buildCuesFromUtterances(utterances, offsetMs));
    } else if (words.length) {
      cues.push(...buildCuesFromWords(words, offsetMs));
    } else if (chunk.text?.trim()) {
      cues.push({
        startMs: offsetMs,
        endMs: offsetMs + RECORDING_SEGMENT_MS,
        text: chunk.text.trim(),
      });
    }
  }
  cues.sort((a, b) => a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs);
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${c.text}`)
      .join('\n\n') + (cues.length ? '\n' : '')
  );
}

async function uploadAudio(blob) {
  const res = await fetch('/api/aai-upload', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const data = await res.json();
  if (!res.ok || !data.upload_url) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data.upload_url;
}

async function transcribeUploadUrl(upload_url) {
  const res = await fetch('/api/transcribe-chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_url }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Transcribe error ${res.status}`);
  return data;
}

async function transcribeSegment(blob, segmentIndex, offsetMs, onProgress) {
  onProgress?.(`Segment ${segmentIndex + 1}: uploading`);
  const upload_url = await uploadAudio(blob);

  onProgress?.(`Segment ${segmentIndex + 1}: transcribing`);
  const result = await transcribeUploadUrl(upload_url);

  return {
    ...result,
    chunkIndex: segmentIndex,
    offsetMs,
  };
}

function mergeChunkResults(results) {
  const ordered = results.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const transcript = ordered
    .map(r => (r.text || r.transcript || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const srt = buildSrtFromChunks(ordered);
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
  const segmentTimerRef = useRef(null);
  const durationRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const shouldContinueRef = useRef(false);
  const finalizedRef = useRef(false);
  const transcriptionJobsRef = useRef([]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const finalizeRecording = async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    shouldContinueRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(segmentTimerRef.current);
    stopStream();
    setState('transcribing');
    setUploadProgress('Finishing transcription...');

    try {
      const settled = await Promise.all(transcriptionJobsRef.current);
      const failed = settled.find(result => result.error);
      if (failed) throw new Error(failed.error);

      const validResults = settled.filter(result =>
        result && ((result.text || result.transcript || '').trim() || result.utterances?.length || result.words?.length)
      );

      if (!validResults.length) {
        throw new Error('No audio was transcribed. Please try recording again.');
      }

      setUploadProgress('Merging results...');
      const data = mergeChunkResults(validResults);

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

  const queueSegmentTranscription = (blob, segmentIndex, offsetMs) => {
    const job = transcribeSegment(blob, segmentIndex, offsetMs, setUploadProgress)
      .catch(err => ({
        chunkIndex: segmentIndex,
        offsetMs,
        error: err.message || 'Segment transcription failed',
      }));
    transcriptionJobsRef.current.push(job);
  };

  const startSegment = () => {
    const stream = streamRef.current;
    if (!stream || !shouldContinueRef.current) return;

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const segmentIndex = segmentIndexRef.current++;
    const offsetMs = durationRef.current * 1000;

    chunksRef.current = [];
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = (e) => {
      shouldContinueRef.current = false;
      setError(`Recording error: ${e.error?.message || e.error || 'Unknown error'}`);
      finalizeRecording();
    };

    recorder.onstop = () => {
      const mime = mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mime });

      if (blob.size > 0) {
        queueSegmentTranscription(blob, segmentIndex, offsetMs);
      }

      if (shouldContinueRef.current) {
        startSegment();
      } else {
        finalizeRecording();
      }
    };

    recorder.start();
    clearTimeout(segmentTimerRef.current);
    segmentTimerRef.current = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, RECORDING_SEGMENT_MS);
  };

  const startRecording = async () => {
    setError('');
    setTranscript('');
    setSrt('');
    setUploadProgress('');
    chunksRef.current = [];
    transcriptionJobsRef.current = [];
    segmentIndexRef.current = 0;
    finalizedRef.current = false;
    shouldContinueRef.current = true;
    setState('recording');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      shouldContinueRef.current = false;
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

    durationRef.current = 0;
    setDuration(0);
    timerRef.current = setInterval(() => {
      durationRef.current += 1;
      setDuration(durationRef.current);
    }, 1000);

    startSegment();
  };

  const stopRecording = () => {
    shouldContinueRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(segmentTimerRef.current);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    } else {
      finalizeRecording();
    }
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
    setUploadProgress('');
    durationRef.current = 0;
    setDuration(0);
  };

  useEffect(() => () => {
    shouldContinueRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(segmentTimerRef.current);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    stopStream();
  }, []);

  return (
    <div className={styles.recorder}>
      <div className={styles.controls}>
        {state === 'idle' && (
          <button className={'btn btn-primary ' + styles.recBtn} onClick={startRecording}>
            Start Recording
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
              Stop
            </button>
          </div>
        )}

        {state === 'transcribing' && (
          <div className={styles.recording}>
            <span className="spinner" style={{ marginRight: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Transcribing... please wait</span>
              {uploadProgress && <span style={{ fontSize: 12, opacity: 0.7 }}>{uploadProgress}</span>}
            </div>
          </div>
        )}

        {state === 'stopped' && (
          <div className={styles.stopped}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-green">Done - {fmt(duration)}</span>
              {srt && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, padding: '4px 12px' }}
                  onClick={downloadSRT}
                >
                  Download .srt
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
