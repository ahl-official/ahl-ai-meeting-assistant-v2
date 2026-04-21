import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { getAllMeetings, getMeetings } from '../../lib/api';
import AdminLayout from '../../components/AdminLayout';
import styles from '../../styles/Admin.module.css';

function useAdminGuard() {
    const { user, loading } = useAuth();
    const router = useRouter();
    useEffect(() => {
        if (!loading && (!user || !user.isAdmin)) router.replace('/admin/login');
    }, [user, loading]);
    return { user, loading, ready: !loading && !!user?.isAdmin };
}

const TYPES = ['All Types', 'Meeting', 'Interview', 'Standup', 'Review', 'Other'];

export default function AdminMeetings() {
    const { user, ready } = useAdminGuard();
    const router = useRouter();

    // ?user=username  → single user's meetings
    // ?view=userdata  → user-picker mode (sidebar shows user list, main area is empty)
    const targetUser = router.query.user || null;
    const viewMode   = router.query.view  || null;
    const isUserMode = !!targetUser;

    const [meetings, setMeetings] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [search, setSearch] = useState('');
    const [ownerFilter, setOwnerFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('All Types');

    // Meeting detail modal
    const [detail, setDetail] = useState(null);

    useEffect(() => {
        if (!ready) return;
        if (!isUserMode) {
            // No user selected yet — don't fetch, just show the picker prompt
            if (viewMode === 'userdata') {
                setMeetings([]);
                setFetching(false);
                return;
            }
        }
        loadMeetings();
    }, [ready, targetUser, viewMode]);

    const loadMeetings = async () => {
        setFetching(true);
        try {
            if (isUserMode) {
                // Load a single user's meetings (uses existing getMeetings action)
                const data = await getMeetings(targetUser);
                const withOwner = (data.meetings || []).map(m => ({ ...m, owner: targetUser }));
                setMeetings(withOwner);
            } else {
                const data = await getAllMeetings(user.username);
                setMeetings(data.meetings || []);
            }
        } catch (err) {
            alert('Failed to load meetings: ' + err.message);
        } finally {
            setFetching(false);
        }
    };

    const owners = [...new Set(meetings.map(m => m.owner))].sort();

    const filtered = meetings.filter(m => {
        const q = search.toLowerCase();
        const matchSearch = !q ||
            m.title?.toLowerCase().includes(q) ||
            m.summary?.toLowerCase().includes(q) ||
            m.owner?.toLowerCase().includes(q);
        const matchOwner = !ownerFilter || m.owner === ownerFilter;
        const matchType = typeFilter === 'All Types' || m.type === typeFilter;
        return matchSearch && matchOwner && matchType;
    });

    const priorityColor = (p) => ({
        high: '#EF4444', medium: '#F59E0B', low: '#10B981'
    }[p] || '#9CA3AF');

    if (!ready) return null;

    // Determine sidebar active key
    const sidebarActive = (isUserMode || viewMode === 'userdata') ? 'userdata' : 'meetings';

    return (
        <AdminLayout active={sidebarActive}>
            <div className={styles.page}>
                <main className={styles.main}>
                    <div className={styles.header}>
                        <div className={styles.headerLeft}>
                            <span className={styles.adminBadge}>Admin Portal</span>
                            <h1 className={styles.title}>
                                {isUserMode ? `${targetUser}'s Meetings` : viewMode === 'userdata' ? 'User Data' : 'All Meetings'}
                            </h1>
                            <p className={styles.subtitle}>
                                {isUserMode
                                    ? `${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} for ${targetUser}`
                                    : viewMode === 'userdata'
                                        ? 'Select a user from the sidebar to view their meetings'
                                        : `${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} across all users`}
                            </p>
                        </div>
                        <div className={styles.headerActions}>
                            {isUserMode && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => router.push('/admin/meetings', undefined, { shallow: true })}
                                >
                                    ← All Meetings
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={loadMeetings}>↻ Refresh</button>
                        </div>
                    </div>

                    <div className={styles.toolbar}>
                        <input
                            className={'input ' + styles.search}
                            placeholder="Search by title, summary, owner…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {!isUserMode && (
                            <select
                                className={styles.filterSelect}
                                value={ownerFilter}
                                onChange={e => setOwnerFilter(e.target.value)}
                            >
                                <option value="">All users</option>
                                {owners.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        )}
                        <select
                            className={styles.filterSelect}
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                        >
                            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    {fetching ? (
                        <div className={styles.loading}><span className="spinner" /> Loading meetings…</div>
                    ) : !isUserMode && viewMode === 'userdata' ? (
                        <div className={styles.empty}>
                            <div className={styles.emptyIcon}>👤</div>
                            <h3>Select a user</h3>
                            <p>Click a user from the sidebar to view their meeting history.</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className={styles.empty}>
                            <div className={styles.emptyIcon}>📭</div>
                            <h3>No meetings found</h3>
                            <p>{search || ownerFilter || typeFilter !== 'All Types'
                                ? 'Try adjusting your filters.'
                                : isUserMode
                                    ? `${targetUser} hasn't recorded any meetings yet.`
                                    : 'No meetings have been recorded yet.'}
                            </p>
                        </div>
                    ) : (
                        <div>
                            {filtered.map((m, i) => (
                                <div
                                    key={i}
                                    className={styles.meetingCard}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setDetail(m)}
                                >
                                    <div className={styles.meetingTop}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className={styles.meetingMeta}>
                                                <span className={styles.ownerBadge}>{m.owner}</span>
                                                <span className="badge badge-blue">{m.type || 'Meeting'}</span>
                                                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                                                    {m.createdAt
                                                        ? new Date(m.createdAt).toLocaleDateString('en-GB', {
                                                            day: 'numeric', month: 'short', year: 'numeric'
                                                        })
                                                        : ''}
                                                </span>
                                            </div>
                                            <h3 className={styles.meetingTitle}>{m.title || 'Untitled Meeting'}</h3>
                                            {m.summary && (
                                                <p className={styles.meetingSummary}>{m.summary}</p>
                                            )}
                                        </div>
                                    </div>

                                    {m.actionPoints?.length > 0 && (
                                        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            {m.actionPoints.slice(0, 4).map((ap, j) => (
                                                <span key={j} style={{
                                                    fontSize: 12, padding: '3px 10px', borderRadius: 20,
                                                    background: 'var(--off-white)', border: '1px solid var(--gray-100)',
                                                    color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 5,
                                                }}>
                                                    <span style={{
                                                        width: 6, height: 6, borderRadius: '50%',
                                                        background: priorityColor(ap.priority), flexShrink: 0
                                                    }} />
                                                    {ap.task?.slice(0, 48)}{ap.task?.length > 48 ? '…' : ''}
                                                </span>
                                            ))}
                                            {m.actionPoints.length > 4 && (
                                                <span style={{ fontSize: 12, color: 'var(--blue)', padding: '3px 10px' }}>
                                                    +{m.actionPoints.length - 4} more
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    <div className={styles.meetingFooter}>
                                        {m.duration ? <span>⏱ {m.duration} min</span> : null}
                                        {m.decisions?.length > 0 && (
                                            <span>📌 {m.decisions.length} decision{m.decisions.length !== 1 ? 's' : ''}</span>
                                        )}
                                        {m.actionPoints?.length > 0 && (
                                            <span>✅ {m.actionPoints.length} action{m.actionPoints.length !== 1 ? 's' : ''}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>

            {/* ── Meeting detail modal ── */}
            {detail && (
                <div className={styles.overlay} onClick={() => setDetail(null)}>
                    <div
                        className={styles.modal}
                        style={{ maxWidth: 680, width: '90vw', maxHeight: '85vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                            <div>
                                <h2 className={styles.modalTitle}>{detail.title || 'Untitled Meeting'}</h2>
                                <p className={styles.modalSub}>
                                    {detail.owner} · {detail.type || 'Meeting'} ·{' '}
                                    {detail.createdAt ? new Date(detail.createdAt).toLocaleDateString('en-GB', {
                                        day: 'numeric', month: 'short', year: 'numeric'
                                    }) : ''}
                                </p>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>✕ Close</button>
                        </div>

                        {detail.summary && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Summary</div>
                                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--gray-700)' }}>{detail.summary}</p>
                            </div>
                        )}

                        {detail.actionPoints?.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Action Points</div>
                                {detail.actionPoints.map((ap, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: priorityColor(ap.priority), flexShrink: 0, marginTop: 5 }} />
                                        <span style={{ fontSize: 13, color: 'var(--gray-700)' }}>{ap.task}</span>
                                        {ap.assignee && <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 'auto', flexShrink: 0 }}>→ {ap.assignee}</span>}
                                    </div>
                                ))}
                            </div>
                        )}

                        {detail.decisions?.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Decisions</div>
                                {detail.decisions.map((d, i) => (
                                    <div key={i} style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 4 }}>📌 {typeof d === 'string' ? d : d.text || JSON.stringify(d)}</div>
                                ))}
                            </div>
                        )}

                        {detail.nextSteps && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Next Steps</div>
                                <p style={{ fontSize: 13, color: 'var(--gray-700)' }}>{detail.nextSteps}</p>
                            </div>
                        )}

                        {detail.transcript && (
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Transcript</div>
                                <div style={{
                                    fontSize: 12.5, lineHeight: 1.7, color: 'var(--gray-600)',
                                    background: 'var(--off-white)', borderRadius: 8, padding: '12px 14px',
                                    maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap',
                                    fontFamily: "'DM Mono', monospace",
                                }}>
                                    {detail.transcript}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}