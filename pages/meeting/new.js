import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../../components/Navbar';
import LiveRecorder from '../../components/LiveRecorder';
import { useAuth } from '../../lib/auth';
import { saveMeeting } from '../../lib/api';
import styles from '../../styles/NewMeeting.module.css';
import { decodeAudioFile, splitAudioBufferIntoWavChunks, sleep, buildSrtFromResults } from '../../lib/audio-processor';

export default function NewMeeting() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [inputMode, setInputMode] = useState('voice');
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [srt, setSrt] = useState('');
  const [duration, setDuration] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploadState, setUploadState] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  const analyzeTranscript = async () => {
    if (!transcript.trim()) return;
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAiResult(data.result);
      if (!title) setTitle(generateTitle(transcript));
    } catch (err) {
      setError('AI analysis failed: ' + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const generateTitle = (text) => {
    const words = text.split(' ').slice(0, 6).join(' ');
    return words.length > 3 ? words + '…' : 'New Meeting';
  };

  const saveMeetingData = async () => {
    if (!title.trim()) { setError('Please add a title.'); return; }
    setSaving(true);
    try {
      const meeting = {
        id: Date.now().toString(),
        title,
        transcript,
        srt,
        summary: aiResult?.summary || '',
        actionPoints: aiResult?.actionPoints || [],
        decisions: aiResult?.decisions || [],
        nextSteps: aiResult?.nextSteps || '',
        duration: Math.round(duration / 60),
        type: 'Meeting',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveMeeting(user.email, meeting);
      router.push(`/meeting/${meeting.id}`);
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setTranscript('');
    setSrt('');
    setUploadState('uploading');
    setUploadProgress(0);

    try {
      // 1. Decode and chunk the audio
      const audioBuffer = await decodeAudioFile(file);
      setDuration(audioBuffer.duration);

      const chunks = await splitAudioBufferIntoWavChunks(audioBuffer, 60); // 60s chunks
      const totalChunks = chunks.length;
      const results = [];

      for (let i = 0; i < chunks.length; i++) {
        setUploadProgress(Math.round(((i) / totalChunks) * 100));

        // 2. Upload chunk and start job
        const uploadRes = await fetch('/api/transcribe-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunks[i].blob,
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || uploadData.error) throw new Error(uploadData.error || `Upload error ${uploadRes.status}`);

        const transcriptId = uploadData.id;

        // 3. Poll for status
        let completed = false;
        let chunkResult = null;
        while (!completed) {
          await sleep(3000);
          const statusRes = await fetch(`/api/transcript-status?id=${transcriptId}`);
          chunkResult = await statusRes.json();

          if (chunkResult.status === 'completed') {
            completed = true;
          } else if (chunkResult.status === 'error') {
            throw new Error(chunkResult.error || 'Transcription error');
          }
        }

        // 4. Attach the correct offset to the result
        chunkResult.offsetMs = chunks[i].startMs;
        results.push(chunkResult);

        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      // 5. Combine results
      const combinedTranscript = results.map(r => r.transcript).join(' ').trim();
      const combinedSrt = buildSrtFromResults(results);

      setTranscript(combinedTranscript);
      setSrt(combinedSrt);
      setUploadState('done');
    } catch (err) {
      console.error(err);
      setError('Upload transcription failed: ' + err.message);
      setUploadState('idle');
    }
  };

  const downloadSRT = () => {
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'transcript') + '.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !user) return null;

  return (
    <div className={styles.page}>
      <Navbar />
      <main className={styles.main}>
        <div className={styles.header}>
          <button className="btn btn-ghost" onClick={() => router.back()}>← Back</button>
          <h1 className={styles.title}>New Meeting</h1>
        </div>

        <div className={styles.layout}>
          <div className={styles.inputSection}>
            <div className={'card ' + styles.card}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Meeting Title</label>
                <input
                  className="input"
                  placeholder="e.g. Q2 Planning Session"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className={styles.modeTabs}>
                <button
                  className={styles.modeTab + (inputMode === 'voice' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('voice')}
                >
                  🎙 Live Voice
                </button>
                <button
                  className={styles.modeTab + (inputMode === 'text' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('text')}
                >
                  ✏️ Type / Paste
                </button>
                <button
                  className={styles.modeTab + (inputMode === 'upload' ? ' ' + styles.modeTabActive : '')}
                  onClick={() => setInputMode('upload')}
                >
                  📁 Upload Audio
                </button>
              </div>

              {inputMode === 'voice' && (
                <LiveRecorder
                  onTranscriptUpdate={setTranscript}
                  onComplete={(t, d, s) => {
                    setTranscript(t);
                    setDuration(d);
                    if (s) setSrt(s);
                  }}
                />
              )}

              {inputMode === 'text' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Transcript / Meeting Notes</label>
                  <textarea
                    className="input"
                    rows={10}
                    placeholder="Paste your meeting transcript or type notes here…"
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                  />
                </div>
              )}

              {inputMode === 'upload' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Audio File</label>
                  <p style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 8 }}>
                    Supports mp3, mp4, wav, m4a, flac, ogg, aac, wma, mov, webm, amr and more
                  </p>
                  <input
                    type="file"
                    accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.webm,.ogg,.flac,.mov,.aac,.wma,.amr"
                    className="input"
                    style={{ padding: '10px' }}
                    onChange={handleFileUpload}
                    disabled={uploadState === 'uploading'}
                  />

                  {uploadState === 'uploading' && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-500)', marginBottom: 4 }}>
                        <span className="spinner" />
                        <span>Transcribing your file ({uploadProgress}%)...</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
                        <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--blue)', transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}

                  {uploadState === 'done' && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-green">✓ Transcription complete — scroll down to analyze</span>
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
                  )}

                  {uploadState === 'done' && transcript && (
                    <div className={styles.fieldGroup} style={{ marginTop: 16 }}>
                      <label className={styles.label}>Transcript Preview</label>
                      <div style={{
                        background: 'var(--off-white)',
                        border: '1px solid var(--gray-200)',
                        borderRadius: 8,
                        padding: 12,
                        fontSize: 13,
                        color: 'var(--gray-600)',
                        maxHeight: 150,
                        overflowY: 'auto',
                        lineHeight: 1.6,
                      }}>
                        {transcript}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.actions}>
                <button
                  className="btn btn-primary"
                  onClick={analyzeTranscript}
                  disabled={analyzing || !transcript.trim() || uploadState === 'uploading'}
                >
                  {analyzing ? <><span className="spinner" /> Analyzing…</> : '✦ Analyze with AI'}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.resultsSection}>
            {!aiResult && !analyzing && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>✦</div>
                <h3>AI Analysis</h3>
                <p>Record or type your meeting content, then click "Analyze with AI" to extract action points, decisions, and a summary.</p>
              </div>
            )}

            {analyzing && (
              <div className={styles.analyzingState}>
                <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                <p>Reading your meeting…</p>
              </div>
            )}

            {aiResult && (
              <div className={styles.results + ' fade-in'}>
                <div className={'card ' + styles.resultCard}>
                  <h3 className={styles.resultTitle}>Summary</h3>
                  <p className={styles.summary}>{aiResult.summary}</p>
                </div>

                {aiResult.actionPoints?.length > 0 && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>
                      Action Points
                      <span className="badge badge-blue" style={{ marginLeft: 8 }}>
                        {aiResult.actionPoints.length}
                      </span>
                    </h3>
                    <div className={styles.apList}>
                      {aiResult.actionPoints.map((ap, i) => (
                        <div key={i} className={styles.apItem}>
                          <div className={styles.apHeader}>
                            <span className={styles.apTask}>{ap.task}</span>
                            <span className={styles['priority-' + ap.priority] + ' badge'}>
                              {ap.priority}
                            </span>
                          </div>
                          <div className={styles.apMeta}>
                            <span>👤 {ap.owner}</span>
                            <span>📅 {ap.dueDate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiResult.decisions?.length > 0 && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>Decisions Made</h3>
                    <ul className={styles.decisionList}>
                      {aiResult.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.nextSteps && (
                  <div className={'card ' + styles.resultCard}>
                    <h3 className={styles.resultTitle}>Next Steps</h3>
                    <p className={styles.summary}>{aiResult.nextSteps}</p>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                  onClick={saveMeetingData}
                  disabled={saving}
                >
                  {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Meeting'}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
