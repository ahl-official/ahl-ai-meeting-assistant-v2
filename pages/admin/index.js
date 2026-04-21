import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { getAllUsers, getAllMeetings } from '../../lib/api';
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

export default function AdminIndex() {
    const { user, ready } = useAdminGuard();
    const [users, setUsers] = useState([]);
    const [meetings, setMeetings] = useState([]);
    const [fetching, setFetching] = useState(true);

    useEffect(() => {
        if (!ready) return;
        (async () => {
            setFetching(true);
            try {
                const [ud, md] = await Promise.all([
                    getAllUsers(user.username),
                    getAllMeetings(user.username),
                ]);
                setUsers(ud.users || []);
                setMeetings(md.meetings || []);
            } catch (err) {
                console.error(err);
            } finally {
                setFetching(false);
            }
        })();
    }, [ready]);

    if (!ready) return null;

    const activeUsers = users.filter(u => u.active).length;
    const totalDuration = meetings.reduce((s, m) => s + (Number(m.duration) || 0), 0);
    const totalActions = meetings.reduce((s, m) => s + (m.actionPoints?.length || 0), 0);
    const recent = [...meetings].slice(0, 8);

    const stats = [
        { icon: '👥', value: users.length, label: 'Total Users', sub: `${activeUsers} active`, color: '#7c3aed' },
        { icon: '📋', value: meetings.length, label: 'Total Meetings', sub: 'across all users', color: '#0891b2' },
        { icon: '⏱', value: totalDuration, label: 'Minutes Logged', sub: `~${Math.round(totalDuration / 60)}h total`, color: '#059669' },
        { icon: '✅', value: totalActions, label: 'Action Points', sub: 'extracted by AI', color: '#d97706' },
    ];

    return (
        <AdminLayout active="dashboard">
            <div className={styles.page}>
                <main className={styles.main}>
                    <div className={styles.header}>
                        <div className={styles.headerLeft}>
                            <span className={styles.adminBadge}>Admin Portal</span>
                            <h1 className={styles.title}>Overview</h1>
                            <p className={styles.subtitle}>Welcome back, {user.username}</p>
                        </div>
                    </div>

                    {fetching ? (
                        <div className={styles.loading}><span className="spinner" /> Loading data…</div>
                    ) : (
                        <>
                            <div className={styles.statsGrid}>
                                {stats.map((s, i) => (
                                    <div key={i} className={styles.statCard} style={{ '--stat-color': s.color }}>
                                        <div className={styles.statIcon}>{s.icon}</div>
                                        <div className={styles.statValue}>{s.value.toLocaleString()}</div>
                                        <div className={styles.statLabel}>{s.label}</div>
                                        <div className={styles.statSub}>{s.sub}</div>
                                    </div>
                                ))}
                            </div>

                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>Recent Meetings</div>
                                {recent.length === 0 ? (
                                    <div className={styles.empty}>
                                        <div className={styles.emptyIcon}>📭</div>
                                        <h3>No meetings yet</h3>
                                        <p>Meetings will appear here once users start recording.</p>
                                    </div>
                                ) : (
                                    <div className={styles.activityList}>
                                        {recent.map((m, i) => (
                                            <div key={i} className={styles.activityRow}>
                                                <span className={styles.activityUser}>{m.owner}</span>
                                                <span className={styles.activityTitle}>{m.title || 'Untitled Meeting'}</span>
                                                <span className="badge badge-blue" style={{ flexShrink: 0 }}>{m.type || 'Meeting'}</span>
                                                <span className={styles.activityDate}>
                                                    {new Date(m.createdAt).toLocaleDateString('en-GB', {
                                                        day: 'numeric', month: 'short', year: 'numeric'
                                                    })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </main>
            </div>
        </AdminLayout>
    );
}