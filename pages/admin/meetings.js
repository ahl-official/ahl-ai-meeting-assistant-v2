import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { getAllMeetings } from '../../lib/api';
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
    const [meetings, setMeetings] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [search, setSearch] = useState('');
    const [ownerFilter, setOwnerFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('All Types');

    useEffect(() => {
        if (!ready) return;
        loadMeetings();
    }, [ready]);

    const loadMeetings = async () => {
        setFetching(true);
        try {
            const data = await getAllMeetings(user.username);
            setMeetings(data.meetings || []);
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

    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <div className={styles.header}>
                    <div className={styles.headerLeft}>
                        <span className={styles.adminBadge}>Admin Portal</span>
                        <h1 className={styles.title}>All Meetings</h1>
                        <p className={styles.subtitle}>{meetings.length} meetings across all users</p>
                    </div>
                    <div className={styles.headerActions}>
                        <button className="btn btn-secondary" onClick={() => router.push('/admin')}>
                            ← Overview
                        </button>
                        <button className="btn btn-secondary" onClick={() => router.push('/admin/users')}>
                            👥 Users
                        </button>
                    </div>
                </div>

                <div className={styles.toolbar}>
                    <input
                        className={'input ' + styles.search}
                        placeholder="Search by title, summary, owner…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <select
                        className={styles.filterSelect}
                        value={ownerFilter}
                        onChange={e => setOwnerFilter(e.target.value)}
                    >
                        <option value="">All users</option>
                        {owners.map(o => (
                            <option key={o} value={o}>{o}</option>
                        ))}
                    </select>
                    <select
                        className={styles.filterSelect}
                        value={typeFilter}
                        onChange={e => setTypeFilter(e.target.value)}
                    >
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={loadMeetings}>↻ Refresh</button>
                </div>

                {fetching ? (
                    <div className={styles.loading}><span className="spinner" /> Loading meetings…</div>
                ) : filtered.length === 0 ? (
                    <div className={styles.empty}>
                        <div className={styles.emptyIcon}>📭</div>
                        <h3>No meetings found</h3>
                        <p>{search || ownerFilter || typeFilter !== 'All Types'
                            ? 'Try adjusting your filters.'
                            : 'No meetings have been recorded yet.'}</p>
                    </div>
                ) : (
                    <div>
                        {filtered.map((m, i) => (
                            <div key={i} className={styles.meetingCard}>
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
                                            <span
                                                key={j}
                                                style={{
                                                    fontSize: 12,
                                                    padding: '3px 10px',
                                                    borderRadius: 20,
                                                    background: 'var(--off-white)',
                                                    border: '1px solid var(--gray-100)',
                                                    color: 'var(--gray-600)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                }}
                                            >
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
                                    {m.nextSteps && (
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            → {m.nextSteps}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}