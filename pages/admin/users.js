import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { getAllUsers, getPassword, setAdmin, setActive } from '../../lib/api';
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

export default function AdminUsers() {
    const { user, ready } = useAdminGuard();
    const [users, setUsers] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [busy, setBusy] = useState({});

    // Password modal
    const [pwModal, setPwModal] = useState(null);
    const [pwValue, setPwValue] = useState('');
    const [pwLoading, setPwLoading] = useState(false);
    const [pwCopied, setPwCopied] = useState(false);

    useEffect(() => {
        if (!ready) return;
        loadUsers();
    }, [ready]);

    const loadUsers = async () => {
        setFetching(true);
        try {
            const data = await getAllUsers(user.username);
            setUsers(data.users || []);
        } catch (err) {
            alert('Failed to load users: ' + err.message);
        } finally {
            setFetching(false);
        }
    };

    const handleGetPassword = async (target) => {
        setPwModal(target);
        setPwValue('');
        setPwCopied(false);
        setPwLoading(true);
        try {
            const data = await getPassword(user.username, target.username);
            setPwValue(data.password);
        } catch (err) {
            setPwValue('Error: ' + err.message);
        } finally {
            setPwLoading(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(pwValue);
        setPwCopied(true);
        setTimeout(() => setPwCopied(false), 2000);
    };

    const handleToggleActive = async (target) => {
        const newVal = !target.active;
        if (!confirm(`${newVal ? 'Activate' : 'Deactivate'} account for ${target.username}?`)) return;
        setBusy(b => ({ ...b, [target.username + '_active']: true }));
        try {
            await setActive(target.username, newVal);
            setUsers(prev => prev.map(u =>
                u.username === target.username ? { ...u, active: newVal } : u
            ));
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            setBusy(b => ({ ...b, [target.username + '_active']: false }));
        }
    };

    const handleToggleAdmin = async (target) => {
        const newVal = !target.isAdmin;
        if (!confirm(`${newVal ? 'Grant' : 'Revoke'} admin access for ${target.username}?`)) return;
        setBusy(b => ({ ...b, [target.username + '_admin']: true }));
        try {
            await setAdmin(user.username, target.username, newVal);
            setUsers(prev => prev.map(u =>
                u.username === target.username ? { ...u, isAdmin: newVal } : u
            ));
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            setBusy(b => ({ ...b, [target.username + '_admin']: false }));
        }
    };

    const filtered = users.filter(u => {
        const q = search.toLowerCase();
        const matchSearch = !q ||
            u.username?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            u.phone?.toLowerCase().includes(q);
        const matchFilter =
            filter === 'all' ? true :
                filter === 'active' ? u.active :
                    filter === 'inactive' ? !u.active :
                        filter === 'admin' ? u.isAdmin : true;
        return matchSearch && matchFilter;
    });

    if (!ready) return null;

    return (
        <AdminLayout active="credentials">
            <div className={styles.page}>
                <main className={styles.main}>
                    <div className={styles.header}>
                        <div className={styles.headerLeft}>
                            <span className={styles.adminBadge}>Admin Portal</span>
                            <h1 className={styles.title}>User Credentials</h1>
                            <p className={styles.subtitle}>{users.length} registered accounts</p>
                        </div>
                        <div className={styles.headerActions}>
                            <button className="btn btn-secondary" onClick={loadUsers}>↻ Refresh</button>
                        </div>
                    </div>

                    <div className={styles.toolbar}>
                        <input
                            className={'input ' + styles.search}
                            placeholder="Search by name, email, phone…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        <select
                            className={styles.filterSelect}
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                        >
                            <option value="all">All users</option>
                            <option value="active">Active only</option>
                            <option value="inactive">Inactive only</option>
                            <option value="admin">Admins only</option>
                        </select>
                    </div>

                    {fetching ? (
                        <div className={styles.loading}><span className="spinner" /> Loading users…</div>
                    ) : filtered.length === 0 ? (
                        <div className={styles.empty}>
                            <div className={styles.emptyIcon}>👤</div>
                            <h3>No users found</h3>
                            <p>{search ? 'Try a different search term.' : 'No users have registered yet.'}</p>
                        </div>
                    ) : (
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Username</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Joined</th>
                                        <th>Status</th>
                                        <th>Role</th>
                                        <th style={{ textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((u, i) => (
                                        <tr key={i}>
                                            <td><span className={styles.usernameCell}>{u.username}</span></td>
                                            <td><span className={styles.emailCell}>{u.email || '—'}</span></td>
                                            <td><span className={styles.emailCell}>{u.phone || '—'}</span></td>
                                            <td>
                                                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                                                    {u.createdAt
                                                        ? new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                                        : '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={'badge ' + (u.active ? 'badge-green' : 'badge-gray')}>
                                                    {u.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td>
                                                {u.isAdmin && <span className="badge badge-blue">Admin</span>}
                                            </td>
                                            <td>
                                                <div className={styles.tdActions}>
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => handleGetPassword(u)}
                                                    >
                                                        🔑 Password
                                                    </button>
                                                    <button
                                                        className={'btn btn-sm ' + (u.active ? 'btn-danger' : 'btn-secondary')}
                                                        onClick={() => handleToggleActive(u)}
                                                        disabled={busy[u.username + '_active']}
                                                    >
                                                        {busy[u.username + '_active'] ? '…' : (u.active ? 'Deactivate' : 'Activate')}
                                                    </button>
                                                    {u.username !== user.username && (
                                                        <button
                                                            className={'btn btn-sm ' + (u.isAdmin ? 'btn-danger' : 'btn-secondary')}
                                                            onClick={() => handleToggleAdmin(u)}
                                                            disabled={busy[u.username + '_admin']}
                                                        >
                                                            {busy[u.username + '_admin'] ? '…' : (u.isAdmin ? 'Revoke Admin' : 'Make Admin')}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </main>
            </div>

            {/* Password modal */}
            {pwModal && (
                <div className={styles.overlay} onClick={() => setPwModal(null)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <h2 className={styles.modalTitle}>Password for {pwModal.username}</h2>
                        <p className={styles.modalSub}>{pwModal.email || pwModal.phone || ''}</p>
                        {pwLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--gray-400)' }}>
                                <span className="spinner" /> Retrieving password…
                            </div>
                        ) : (
                            <div className={styles.passwordBox}>{pwValue}</div>
                        )}
                        <div className={styles.modalActions}>
                            <button className="btn btn-primary" onClick={handleCopy} disabled={!pwValue || pwLoading}>
                                {pwCopied ? '✓ Copied!' : '📋 Copy'}
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setPwModal(null); setPwValue(''); }}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}