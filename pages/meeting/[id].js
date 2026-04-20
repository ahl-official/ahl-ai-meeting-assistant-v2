import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../../components/Navbar';
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

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  useEffect(() => {
    if (user && id) fetchMeeting();
  }, [user, id]);

  // FIX: Coerce user.phone to string to prevent .trim() TypeError
  useEffect(() => {
    if (waModal && user?.phone) setUserPhone(String(user.phone));
  }, [waModal]);

  const fetchMeeting = async () => {
    setFetching(true);
    try {
      const data = await getMeetings(user.email);
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
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await updateMeeting(user.email, id, { ...editData, updatedAt: new Date().toISOString() });
      setMeeting(m => ({ ...m, ...editData }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
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
      actionPoints: [...d.actionPoints, { id: Date.now().toString(), task: '', owner: '', priority: 'medium', dueDate: 'TBD' }]
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

  // FIX: Coerce both phone values to strings before calling .trim()
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
        }),
      });
      const data = await res.json();
      if (!data.success && !data.results) throw new Error(data.error || 'Send failed');
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

  // FIX: Safe trimmed values for the disabled check on the Send button
  const uPhoneTrimmed = String(userPhone ?? '').trim();
  const cPhoneTrimmed = String(coordPhone ?? '').trim();

  return (
    <div className={styles.page}>
      <Navbar />
      <main className={styles.main}>

        <div className={styles.header}>
          <button className="btn btn-ghost" onClick={() => router.push('/dashboard')}>← Meetings</button>
          <div className={styles.headerRight}>
            <span className={styles.date}>
              {new Date(meeting.createdAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            {meeting.duration > 0 && <span className="badge badge-gray">{meeting.duration} min</span>}
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

        {tab === 'overview' && (
          <div className={styles.content + ' fade-in'}>
            <div className={styles.grid}>
              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Summary</h2>
                <p className={styles.cardText}>{meeting.summary || 'No summary available.'}</p>
              </div>

              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>
                  Action Points
                  <span className="badge badge-blue" style={{ marginLeft: 8 }}>{meeting.actionPoints?.length || 0}</span>
                </h2>
                {meeting.actionPoints?.length > 0 ? (
                  <div className={styles.apList}>
                    {meeting.actionPoints.map((ap, i) => (
                      <div key={i} className={styles.apItem}>
                        <div className={styles.apLeft}>
                          <span className={styles.priorityDot} style={{ background: priorityColor(ap.priority) }} />
                          <div>
                            <div className={styles.apTask}>{ap.task}</div>
                            <div className={styles.apMeta}>
                              <span>👤 {ap.owner}</span>
                              <span>📅 {ap.dueDate}</span>
                            </div>
                          </div>
                        </div>
                        <span className={styles['priority-' + ap.priority] + ' badge'}>{ap.priority}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.empty}>No action points captured.</p>}
              </div>

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

        {tab === 'transcript' && (
          <div className={styles.content + ' fade-in'}>
            <div className={'card ' + styles.card} style={{ maxWidth: 800 }}>
              <h2 className={styles.cardTitle}>Full Transcript</h2>
              <pre className={styles.transcript}>{meeting.transcript || 'No transcript available.'}</pre>
            </div>
          </div>
        )}

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

              <div className={'card ' + styles.card}>
                <div className={styles.cardTitleRow}>
                  <h2 className={styles.cardTitle}>Action Points</h2>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={addAP}>+ Add</button>
                </div>
                <div className={styles.apList}>
                  {editData.actionPoints?.map((ap, i) => (
                    <div key={i} className={styles.apEditItem}>
                      <div className={styles.apEditRow}>
                        <input className="input" placeholder="Task description" value={ap.task} onChange={e => updateAP(i, 'task', e.target.value)} />
                        <button className="btn btn-danger" style={{ padding: '8px 10px', flexShrink: 0 }} onClick={() => removeAP(i)}>✕</button>
                      </div>
                      <div className={styles.apEditMeta}>
                        <input className="input" placeholder="Owner" value={ap.owner} onChange={e => updateAP(i, 'owner', e.target.value)} style={{ flex: 1 }} />
                        <select className="input" value={ap.priority} onChange={e => updateAP(i, 'priority', e.target.value)} style={{ flex: 0.8 }}>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <input className="input" placeholder="Due date" value={ap.dueDate} onChange={e => updateAP(i, 'dueDate', e.target.value)} style={{ flex: 1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={'card ' + styles.card}>
                <h2 className={styles.cardTitle}>Decisions</h2>
                {editData.decisions?.map((d, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input className="input" value={d} onChange={e => {
                      const arr = [...editData.decisions];
                      arr[i] = e.target.value;
                      setEditData(ed => ({ ...ed, decisions: arr }));
                    }} />
                    <button className="btn btn-danger" style={{ padding: '8px 10px' }} onClick={() => {
                      setEditData(ed => ({ ...ed, decisions: ed.decisions.filter((_, j) => j !== i) }));
                    }}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditData(d => ({ ...d, decisions: [...d.decisions, ''] }))}>
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

      {/* ── WhatsApp Modal ─────────────────────────────────── */}
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

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)', margin: 0 }}>
                  📲 Send via WhatsApp
                </h2>
                <p style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 4, marginBottom: 0 }}>
                  Sends the action plan summary to both numbers
                </p>
              </div>
              <button onClick={closeWaModal} disabled={waSending}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-400)', paddingTop: 2 }}>
                ✕
              </button>
            </div>

            {/* Success */}
            {waStatus === 'success' && (
              <div style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 10, padding: '16px 18px', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>✅ Messages sent successfully!</div>
                {waResults?.user === 'sent' && userPhone && <div>📱 You ({userPhone}) — delivered</div>}
                {waResults?.coordinator === 'sent' && coordPhone && <div>📱 Coordinator ({coordPhone}) — delivered</div>}
              </div>
            )}

            {/* Partial */}
            {waStatus === 'partial' && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 10, padding: '16px 18px', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ Partially sent</div>
                {waResults?.user === 'sent' && <div>✓ You — delivered</div>}
                {waResults?.coordinator === 'sent' && <div>✓ Coordinator — delivered</div>}
                {waError && <div style={{ marginTop: 6, fontSize: 12, whiteSpace: 'pre-line' }}>{waError}</div>}
              </div>
            )}

            {/* Error */}
            {waStatus === 'error' && (
              <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 10, padding: '14px 16px', fontSize: 13, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>❌ Failed to send</div>
                <div style={{ wordBreak: 'break-word' }}>{waError}</div>
              </div>
            )}

            {/* Form — hidden after full success */}
            {waStatus !== 'success' && (
              <>
                {/* Meeting pill */}
                <div style={{
                  background: 'var(--off-white)', border: '1px solid var(--gray-200)',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 20,
                  fontSize: 13, color: 'var(--gray-600)',
                }}>
                  <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>{meeting.title || 'Untitled Meeting'}</span>
                  <span style={{ marginLeft: 8, color: 'var(--gray-400)' }}>
                    · {meeting.actionPoints?.length || 0} action points · {meeting.decisions?.length || 0} decisions
                  </span>
                </div>

                {/* Your number */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray-500)', marginBottom: 6 }}>
                    Your WhatsApp Number
                  </label>
                  <input
                    className="input" type="tel"
                    placeholder="e.g. +91 98765 43210"
                    value={userPhone}
                    onChange={e => setUserPhone(e.target.value)}
                    disabled={waSending}
                  />
                  <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>Include country code · e.g. +91 for India</p>
                </div>

                {/* Coordinator number */}
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray-500)', marginBottom: 6 }}>
                    Process Coordinator's Number{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </label>
                  <input
                    className="input" type="tel"
                    placeholder="e.g. +91 9987921288"
                    value={coordPhone}
                    onChange={e => setCoordPhone(e.target.value)}
                    disabled={waSending}
                  />
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={closeWaModal} disabled={waSending} style={{ flex: 1 }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={sendWhatsApp}
                    // FIX: Use pre-computed safe trimmed values for the disabled check
                    disabled={waSending || (!uPhoneTrimmed && !cPhoneTrimmed)}
                    style={{ flex: 2, justifyContent: 'center', gap: 8 }}
                  >
                    {waSending ? <><span className="spinner" /> Sending…</> : '📲 Send Action Plan'}
                  </button>
                </div>
              </>
            )}

            {waStatus === 'success' && (
              <button className="btn btn-primary" onClick={closeWaModal} style={{ width: '100%', justifyContent: 'center' }}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}