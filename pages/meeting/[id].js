import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../../components/Navbar';
import TaskPanel from '../../components/TaskPanel';
import { useAuth } from '../../lib/auth';
import { getMeetings, updateMeeting } from '../../lib/api';
import styles from '../../styles/MeetingDetail.module.css';

export default function MeetingDetail() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { id } = router.query;

  const [meeting, setMeeting] = useState(null);
  const [fetching, setFetching] = useState(true);
  const [tab, setTab] = useState('overview');
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingAP, setEditingAP] = useState(null);

  // WhatsApp modal state
  const [waModal, setWaModal] = useState(false);
  const [userPhone, setUserPhone] = useState('');
  const [coordPhone, setCoordPhone] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [waStatus, setWaStatus] = useState(null);
  const [waError, setWaError] = useState('');
  const [waResults, setWaResults] = useState(null);

  // Debounce ref — prevents hammering Apps Script on every keystroke
  const autoSaveTimer = useRef(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  useEffect(() => {
    if (user && id) fetchMeeting();
  }, [user, id]);

  useEffect(() => {
    if (waModal && user?.phone) setUserPhone(String(user.phone));
  }, [waModal]);

  // Clean up debounce timer when component unmounts
  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  const fetchMeeting = async () => {
    setFetching(true);
    try {
      const data = await getMeetings(user.username);
      const found = (data.meetings || []).find(m => m.id === id);
      if (!found) { router.push('/dashboard'); return; }
      setMeeting(found);
      setEditData({
        title: found.title,
        summary: found.summary,
        transcript: found.transcript,
        nextSteps: found.nextSteps,
        actionPoints: JSON.parse(JSON.stringify(found.actionPoints || [])),
        decisions: [...(found.decisions || [])],
        tasks: JSON.parse(JSON.stringify(found.tasks || [])),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  };

  // ── Manual full save (Edit tab "Save Changes" button) ─────────────────────
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = { ...editData, updatedAt: new Date().toISOString() };
      await updateMeeting(user.username, id, payload);
      setMeeting(m => ({ ...m, ...payload }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save triggered by TaskPanel on every AP or task change ───────────
  // This is the KEY fix: previously this only updated local state.
  // Now it also persists actionPoints + tasks to Google Sheets via updateMeeting.
  // A 600ms debounce prevents a flood of requests when the user edits quickly.
  const handleTasksPanelChange = ({ actionPoints, tasks }) => {
    // 1. Update local state immediately so the UI stays responsive
    setEditData(d => ({ ...d, actionPoints, tasks }));

    // 2. Debounced persist to Sheets
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        await updateMeeting(user.username, id, {
          actionPoints,
          tasks,
          updatedAt: new Date().toISOString(),
        });
        // Keep top-level meeting state in sync (used by WhatsApp modal counts)
        setMeeting(m => ({ ...m, actionPoints, tasks }));
      } catch (err) {
        console.error('[auto-save tasks]', err);
        setError('Tasks generated but failed to save: ' + err.message);
      } finally {
        setAutoSaving(false);
      }
    }, 600);
  };

  const updateAP = (index, field, value) => {
    setEditData(d => {
      const aps = [...d.actionPoints];
      aps[index] = { ...aps[index], [field]: value };
      return { ...d, actionPoints: aps };
    });
  };

  const addAP = () => {
    setEditData(d => ({
      ...d,
      actionPoints: [
        ...d.actionPoints,
        { id: Date.now().toString(), task: '', owner: '', priority: 'medium', dueDate: 'TBD' }
      ]
    }));
    setEditingAP(editData.actionPoints.length);
  };

  const removeAP = (index) => {
    setEditData(d => ({ ...d, actionPoints: d.actionPoints.filter((_, i) => i !== index) }));
  };

  const priorityColor = (p) => ({ high: '#EF4444', medium: '#F59E0B', low: '#10B981' }[p] || '#9CA3AF');

  const openWaModal = () => {
    setWaStatus(null);
    setWaError('');
    setWaResults(null);
    setCoordPhone('');
    setWaModal(true);
  };

  const closeWaModal = () => {
    if (waSending) return;
    setWaModal(false);
  };

  const sendWhatsApp = async () => {
    const uPhone = String(userPhone ?? '');
    const cPhone = String(coordPhone ?? '');
    if (!uPhone.trim() && !cPhone.trim()) {
      setWaError('Enter at least one phone number.');
      return;
    }
    setWaSending(true);
    setWaError('');
    setWaStatus(null);
    setWaResults(null);
    try {
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting,
          userPhone: uPhone.trim() || null,
          coordinatorPhone: cPhone.trim() || null,
          username: user?.username || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setWaResults(data.results || null);
        throw new Error(data.error || 'Send failed');
      }
      setWaResults(data.results);
      setWaStatus(data.errors?.length > 0 ? 'partial' : 'success');
      if (data.errors?.length > 0) setWaError(data.errors.join('\n'));
    } catch (err) {
      setWaStatus('error');
      setWaError(err.message);
    } finally {
      setWaSending(false);
    }
  };

  if (loading || !user || fetching) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--off-white)' }}>
        <Navbar />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px', color: 'var(--gray-400)' }}>
          <span className="spinner" />
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  const uPhoneTrimmed = String(userPhone ?? '').trim();
  const cPhoneTrimmed = String(coordPhone ?? '').trim();

  return (
    <div className={styles.page}>
      <Navbar />
      <main className={styles.main}>

        <div className={styles.header}>
          <button className="btn btn-ghost" onClick={() => router.push('/dashboard')}>
            ← Meetings
          </button>
          <div className={styles.headerRight}>
            <span className={styles.date}>
              {new Date(meeting.createdAt).toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
              })}
            </span>
            {meeting.duration > 0 && (
              <span className="badge badge-gray">{meeting.duration} min</span>
            )}
            {/* Auto-save indicator — shows while debounced save is in flight */}
            {autoSaving && (
              <span style={{ fontSize: 12, color: 'var(--gray-400)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="spinner" style={{ width: 12, height: 12 }} /> Saving…
              </span>
            )}
            <button
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              onClick={openWaModal}
            >
              <span style={{ fontSize: 16 }}>📲</span> Send via WhatsApp
            </button>
          </div>
        </div>

        <div className={styles.titleRow}>
          {tab === 'edit' ? (
            <input
              className={'input ' + styles.titleInput}
              value={editData.title}
              onChange={e => setEditData(d => ({ ...d, title: e.target.value }))}
              placeholder="Meeting title"
            />
          ) : (
            <h1 className={styles.title}>{meeting.title}</h1>
          )}
        </div>

        <div className={styles.tabs}>
          {['overview', 'transcript', 'edit'].map(t => (
            <button
              key={t}
              className={styles.tab + (tab === t ? ' ' + styles.tabActive : '')}
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? '✦ Overview' : t === 'transcript' ? '📝 Transcript' : '✏️ Edit'}
            </button>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div className={styles.content + ' fade-in'}>
            <div className={styles.grid}>
              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Summary</h2>
                <p className={styles.cardText}>{meeting.summary || 'No summary available.'}</p>
              </div>

              <TaskPanel
                actionPoints={editData.actionPoints || meeting.actionPoints || []}
                tasks={editData.tasks || meeting.tasks || []}
                onTasksChange={handleTasksPanelChange}
              />

              {meeting.decisions?.length > 0 && (
                <div className={'card ' + styles.card}>
                  <h2 className={styles.cardTitle}>Decisions</h2>
                  <ul className={styles.decisionList}>
                    {meeting.decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}

              {meeting.nextSteps && (
                <div className={'card ' + styles.card}>
                  <h2 className={styles.cardTitle}>Next Steps</h2>
                  <p className={styles.cardText}>{meeting.nextSteps}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Transcript tab ── */}
        {tab === 'transcript' && (
          <div className={styles.content + ' fade-in'}>
            <div className={'card ' + styles.card} style={{ maxWidth: 800 }}>
              <h2 className={styles.cardTitle}>Full Transcript</h2>
              <pre className={styles.transcript}>{meeting.transcript || 'No transcript available.'}</pre>
            </div>
          </div>
        )}

        {/* ── Edit tab ── */}
        {tab === 'edit' && (
          <div className={styles.content + ' fade-in'}>
            <div className={styles.editGrid}>
              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Summary</h2>
                <textarea
                  className="input"
                  rows={4}
                  value={editData.summary}
                  onChange={e => setEditData(d => ({ ...d, summary: e.target.value }))}
                />
              </div>

              <TaskPanel
                actionPoints={editData.actionPoints || []}
                tasks={editData.tasks || []}
                onTasksChange={handleTasksPanelChange}
              />

              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Decisions</h2>
                {editData.decisions?.map((d, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      className="input"
                      value={d}
                      onChange={e => {
                        const arr = [...editData.decisions];
                        arr[i] = e.target.value;
                        setEditData(ed => ({ ...ed, decisions: arr }));
                      }}
                    />
                    <button
                      className="btn btn-danger"
                      style={{ padding: '8px 10px' }}
                      onClick={() => setEditData(ed => ({
                        ...ed, decisions: ed.decisions.filter((_, j) => j !== i)
                      }))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => setEditData(d => ({ ...d, decisions: [...d.decisions, ''] }))}
                >
                  + Add decision
                </button>
              </div>

              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Notes / Transcript</h2>
                <textarea
                  className="input"
                  rows={8}
                  value={editData.transcript}
                  onChange={e => setEditData(d => ({ ...d, transcript: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.saveRow}>
              {error && <span className={styles.error}>{error}</span>}
              {saved && <span className="badge badge-green">✓ Saved</span>}
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Changes'}
              </button>
            </div>
          </div>
        )}

      </main>

      {/* ── WhatsApp Modal ── */}
      {waModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeWaModal(); }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 32,
            width: '100%', maxWidth: 460,
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)', margin: 0 }}>
                  📲 Send via WhatsApp
                </h2>
                <p style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 4, marginBottom: 0 }}>
                  Sends the action plan summary to both numbers
                </p>
              </div>
              <button
                onClick={closeWaModal}
                disabled={waSending}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-400)', paddingTop: 2 }}
              >
                ✕
              </button>
            </div>

            {waStatus === 'success' && (
              <div style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 10, padding: '16px 18px', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>✅ Messages sent successfully!</div>
                {waResults?.user === 'sent' && userPhone && <div>📱 You ({userPhone}) — delivered</div>}
                {waResults?.coordinator === 'sent' && coordPhone && <div>📱 Coordinator ({coordPhone}) — delivered</div>}
              </div>
            )}

            {waStatus === 'partial' && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 10, padding: '16px 18px', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ Partially sent</div>
                {waResults?.user === 'sent' && <div>✓ You — delivered</div>}
                {waResults?.coordinator === 'sent' && <div>✓ Coordinator — delivered</div>}
                {waError && <div style={{ marginTop: 6, fontSize: 12, whiteSpace: 'pre-line' }}>{waError}</div>}
              </div>
            )}

            {waStatus === 'error' && (
              <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 10, padding: '14px 16px', fontSize: 13, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>❌ Failed to send</div>
                <div style={{ wordBreak: 'break-word' }}>{waError}</div>
              </div>
            )}

            {waStatus !== 'success' && (
              <>
                <div style={{
                  background: 'var(--off-white)', border: '1px solid var(--gray-200)',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 20,
                  fontSize: 13, color: 'var(--gray-600)',
                }}>
                  <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>
                    {meeting.title || 'Untitled Meeting'}
                  </span>
                  <span style={{ marginLeft: 8, color: 'var(--gray-400)' }}>
                    · {meeting.actionPoints?.length || 0} action points
                    · {meeting.tasks?.length || 0} tasks
                    · {meeting.decisions?.length || 0} decisions
                  </span>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray-500)', marginBottom: 6 }}>
                    Your WhatsApp Number
                  </label>
                  <input
                    className="input"
                    type="tel"
                    placeholder="e.g. +91 98765 43210"
                    value={userPhone}
                    onChange={e => setUserPhone(e.target.value)}
                    disabled={waSending}
                  />
                  <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                    Include country code · e.g. +91 for India
                  </p>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray-500)', marginBottom: 6 }}>
                    Process Coordinator's Number{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </label>
                  <input
                    className="input"
                    type="tel"
                    placeholder="e.g. +91 9987921288"
                    value={coordPhone}
                    onChange={e => setCoordPhone(e.target.value)}
                    disabled={waSending}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={closeWaModal} disabled={waSending} style={{ flex: 1 }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={sendWhatsApp}
                    disabled={waSending || (!uPhoneTrimmed && !cPhoneTrimmed)}
                    style={{ flex: 2, justifyContent: 'center', gap: 8 }}
                  >
                    {waSending ? <><span className="spinner" /> Sending…</> : '📲 Send Action Plan'}
                  </button>
                </div>
              </>
            )}

            {waStatus === 'success' && (
              <button
                className="btn btn-primary"
                onClick={closeWaModal}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
