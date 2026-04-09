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
  const [tab, setTab] = useState('overview'); // overview | transcript | edit
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [editingAP, setEditingAP] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading]);

  useEffect(() => {
    if (user && id) fetchMeeting();
  }, [user, id]);

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

        {/* OVERVIEW TAB */}
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

        {/* TRANSCRIPT TAB */}
        {tab === 'transcript' && (
          <div className={styles.content + ' fade-in'}>
            <div className={'card ' + styles.card} style={{ maxWidth: 800 }}>
              <h2 className={styles.cardTitle}>Full Transcript</h2>
              <pre className={styles.transcript}>{meeting.transcript || 'No transcript available.'}</pre>
            </div>
          </div>
        )}

        {/* EDIT TAB */}
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
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={addAP}>
                    + Add
                  </button>
                </div>
                <div className={styles.apList}>
                  {editData.actionPoints?.map((ap, i) => (
                    <div key={i} className={styles.apEditItem}>
                      <div className={styles.apEditRow}>
                        <input
                          className="input"
                          placeholder="Task description"
                          value={ap.task}
                          onChange={e => updateAP(i, 'task', e.target.value)}
                        />
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
    </div>
  );
}
