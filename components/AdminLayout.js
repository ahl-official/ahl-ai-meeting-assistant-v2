import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { getAllUsers, getPassword, getMeetings } from '../lib/api';

const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', icon: '▦' },
    { key: 'credentials', label: 'User Credentials', icon: '🔑' },
    { key: 'userdata', label: 'User Data', icon: '👤' },
    { key: 'meetings', label: 'All Meetings', icon: '📋' },
    { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function AdminLayout({ children, active }) {
    const router = useRouter();
    const { user, signOut } = useAuth();

    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    // Credentials section
    const [credOpen, setCredOpen] = useState({});   // { username: bool }
    const [credData, setCredData] = useState({});   // { username: { password, loading } }
    const [credCopied, setCredCopied] = useState({});

    // User Data section
    const [selectedUser, setSelectedUser] = useState(null);

    // Sidebar collapsed on mobile
    const [collapsed, setCollapsed] = useState(false);

    const needsUsers = active === 'credentials' || active === 'userdata' || active === 'userdata-browse';

    useEffect(() => {
        if (!user || !needsUsers) return;
        setLoadingUsers(true);
        getAllUsers(user.username)
            .then(d => setUsers(d.users || []))
            .catch(console.error)
            .finally(() => setLoadingUsers(false));
    }, [user, active]);

    const handleNav = (key) => {
        const routes = {
            dashboard: '/admin',
            credentials: '/admin/users',
            userdata: '/admin/meetings?view=userdata',
            meetings: '/admin/meetings',
            settings: '/admin/settings',
        };
        router.push(routes[key] || '/admin');
    };

    const handleSignOut = () => {
        signOut();
        router.push('/admin/login');
    };

    // ── Credentials: expand/collapse a user row ──────────────────
    const toggleCred = async (u) => {
        const isOpen = credOpen[u.username];
        setCredOpen(prev => ({ ...prev, [u.username]: !isOpen }));
        if (!isOpen && !credData[u.username]?.password) {
            setCredData(prev => ({ ...prev, [u.username]: { loading: true } }));
            try {
                const d = await getPassword(user.username, u.username);
                setCredData(prev => ({ ...prev, [u.username]: { password: d.password, loading: false } }));
            } catch (err) {
                setCredData(prev => ({ ...prev, [u.username]: { password: 'Error: ' + err.message, loading: false } }));
            }
        }
    };

    const copyCred = (username, text) => {
        navigator.clipboard.writeText(text);
        setCredCopied(prev => ({ ...prev, [username]: true }));
        setTimeout(() => setCredCopied(prev => ({ ...prev, [username]: false })), 2000);
    };

    // ── User Data: select a user → main content changes ──────────
    const selectUser = (u) => {
        setSelectedUser(u);
        // Pass selected user via query so the meetings page can pick it up
        router.push(`/admin/meetings?user=${encodeURIComponent(u.username)}`, undefined, { shallow: true });
    };

    return (
        <div style={styles.shell}>
            {/* ── Sidebar ───────────────────────────────────────────── */}
            <aside style={{ ...styles.sidebar, width: collapsed ? 56 : 260 }}>

                {/* Logo / collapse toggle */}
                <div style={styles.sidebarTop}>
                    {!collapsed && (
                        <div style={styles.brand}>
                            <span style={styles.brandIcon}>⬡</span>
                            <span style={styles.brandText}>Admin</span>
                        </div>
                    )}
                    <button style={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}>
                        {collapsed ? '›' : '‹'}
                    </button>
                </div>

                {/* Nav items */}
                <nav style={styles.nav}>
                    {NAV_ITEMS.map(item => {
                        const isActive = active === item.key;
                        return (
                            <div key={item.key}>
                                <button
                                    style={{
                                        ...styles.navBtn,
                                        ...(isActive ? styles.navBtnActive : {}),
                                        justifyContent: collapsed ? 'center' : 'flex-start',
                                    }}
                                    onClick={() => handleNav(item.key)}
                                    title={collapsed ? item.label : undefined}
                                >
                                    <span style={styles.navIcon}>{item.icon}</span>
                                    {!collapsed && <span style={styles.navLabel}>{item.label}</span>}
                                </button>

                                {/* ── Credentials sub-list ── */}
                                {!collapsed && active === 'credentials' && item.key === 'credentials' && (
                                    <div style={styles.subList}>
                                        {loadingUsers ? (
                                            <div style={styles.subLoading}>Loading…</div>
                                        ) : users.length === 0 ? (
                                            <div style={styles.subLoading}>No users</div>
                                        ) : users.map(u => (
                                            <div key={u.username} style={styles.credItem}>
                                                <button
                                                    style={styles.credRow}
                                                    onClick={() => toggleCred(u)}
                                                >
                                                    <span style={styles.credAvatar}>
                                                        {u.username[0].toUpperCase()}
                                                    </span>
                                                    <span style={styles.credName}>{u.username}</span>
                                                    <span style={{
                                                        ...styles.credChevron,
                                                        transform: credOpen[u.username] ? 'rotate(90deg)' : 'none'
                                                    }}>›</span>
                                                </button>

                                                {credOpen[u.username] && (
                                                    <div style={styles.credExpanded}>
                                                        {credData[u.username]?.loading ? (
                                                            <div style={styles.credLoading}>Fetching…</div>
                                                        ) : (
                                                            <>
                                                                <div style={styles.credField}>
                                                                    <span style={styles.credFieldLabel}>Username</span>
                                                                    <div style={styles.credFieldRow}>
                                                                        <span style={styles.credFieldValue}>{u.username}</span>
                                                                        <button style={styles.copyBtn} onClick={() => copyCred(u.username + '_u', u.username)}>
                                                                            {credCopied[u.username + '_u'] ? '✓' : '⧉'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div style={styles.credField}>
                                                                    <span style={styles.credFieldLabel}>Password</span>
                                                                    <div style={styles.credFieldRow}>
                                                                        <span style={styles.credFieldValue}>
                                                                            {credData[u.username]?.password || '—'}
                                                                        </span>
                                                                        <button
                                                                            style={styles.copyBtn}
                                                                            onClick={() => copyCred(u.username + '_p', credData[u.username]?.password)}
                                                                            disabled={!credData[u.username]?.password}
                                                                        >
                                                                            {credCopied[u.username + '_p'] ? '✓' : '⧉'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                {u.email && (
                                                                    <div style={styles.credMeta}>{u.email}</div>
                                                                )}
                                                                {u.phone && (
                                                                    <div style={styles.credMeta}>{u.phone}</div>
                                                                )}
                                                                <div style={styles.credMeta}>
                                                                    <span style={{
                                                                        ...styles.credStatus,
                                                                        background: u.active ? '#dcfce7' : '#fee2e2',
                                                                        color: u.active ? '#166534' : '#991b1b',
                                                                    }}>
                                                                        {u.active ? 'Active' : 'Inactive'}
                                                                    </span>
                                                                    {u.isAdmin && (
                                                                        <span style={styles.credAdminBadge}>Admin</span>
                                                                    )}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* ── User Data sub-list ── */}
                                {!collapsed && active === 'userdata' && item.key === 'userdata' && (
                                    <div style={styles.subList}>
                                        {loadingUsers ? (
                                            <div style={styles.subLoading}>Loading…</div>
                                        ) : users.length === 0 ? (
                                            <div style={styles.subLoading}>No users</div>
                                        ) : users.map(u => (
                                            <button
                                                key={u.username}
                                                style={{
                                                    ...styles.userDataRow,
                                                    ...(selectedUser?.username === u.username ? styles.userDataRowActive : {}),
                                                }}
                                                onClick={() => selectUser(u)}
                                            >
                                                <span style={styles.credAvatar}>
                                                    {u.username[0].toUpperCase()}
                                                </span>
                                                <div style={styles.userDataInfo}>
                                                    <span style={styles.userDataName}>{u.username}</span>
                                                    <span style={styles.userDataSub}>{u.email || u.phone || '—'}</span>
                                                </div>
                                                <span style={{
                                                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                                    background: u.active ? '#22c55e' : '#9ca3af',
                                                }} />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                {/* Bottom: user + sign out */}
                {!collapsed && (
                    <div style={styles.sidebarBottom}>
                        <div style={styles.adminUser}>
                            <div style={styles.adminAvatar}>
                                {user?.username?.[0]?.toUpperCase() || 'A'}
                            </div>
                            <div style={styles.adminInfo}>
                                <span style={styles.adminName}>{user?.username}</span>
                                <span style={styles.adminRole}>Administrator</span>
                            </div>
                        </div>
                        <button style={styles.signOutBtn} onClick={handleSignOut}>
                            Sign out
                        </button>
                    </div>
                )}
                {collapsed && (
                    <button style={{ ...styles.signOutBtn, margin: '8px auto', width: 36 }} onClick={handleSignOut} title="Sign out">
                        ↩
                    </button>
                )}
            </aside>

            {/* ── Main content ─────────────────────────────────────── */}
            <main style={styles.content}>
                {children}
            </main>
        </div>
    );
}

// ── Styles ────────────────────────────────────────────────────
const styles = {
    shell: {
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg, #f8f7f4)',
        fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
    },
    sidebar: {
        display: 'flex',
        flexDirection: 'column',
        background: '#0f0f10',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        transition: 'width 0.2s ease',
        overflowX: 'hidden',
        overflowY: 'auto',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
    },
    sidebarTop: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
    },
    brand: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
    },
    brandIcon: {
        fontSize: 22,
        color: '#a78bfa',
    },
    brandText: {
        fontSize: 15,
        fontWeight: 600,
        color: '#f5f5f0',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
    },
    collapseBtn: {
        background: 'rgba(255,255,255,0.07)',
        border: 'none',
        borderRadius: 6,
        color: '#9ca3af',
        width: 26,
        height: 26,
        cursor: 'pointer',
        fontSize: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    nav: {
        flex: 1,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        overflowY: 'auto',
    },
    navBtn: {
        width: '100%',
        background: 'none',
        border: 'none',
        borderRadius: 8,
        padding: '9px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        color: '#9ca3af',
        fontSize: 13.5,
        fontWeight: 500,
        transition: 'background 0.15s, color 0.15s',
        textAlign: 'left',
        whiteSpace: 'nowrap',
    },
    navBtnActive: {
        background: 'rgba(167,139,250,0.15)',
        color: '#c4b5fd',
    },
    navIcon: {
        fontSize: 16,
        flexShrink: 0,
        width: 20,
        textAlign: 'center',
    },
    navLabel: {
        flex: 1,
    },
    subList: {
        margin: '4px 0 8px 12px',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        paddingLeft: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
    },
    subLoading: {
        fontSize: 12,
        color: '#6b7280',
        padding: '6px 8px',
    },

    // ── Credentials ───────────────────────────────────────────
    credItem: {
        borderRadius: 6,
        overflow: 'hidden',
    },
    credRow: {
        width: '100%',
        background: 'none',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        borderRadius: 6,
        color: '#d1d5db',
        fontSize: 12.5,
        textAlign: 'left',
        transition: 'background 0.1s',
    },
    credAvatar: {
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: 'rgba(167,139,250,0.2)',
        color: '#c4b5fd',
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    credName: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    credChevron: {
        fontSize: 14,
        color: '#6b7280',
        transition: 'transform 0.15s',
        flexShrink: 0,
    },
    credExpanded: {
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 6,
        padding: '10px 10px 8px',
        margin: '2px 0 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
    },
    credLoading: {
        fontSize: 11,
        color: '#6b7280',
        textAlign: 'center',
        padding: '4px 0',
    },
    credField: {
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
    },
    credFieldLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: '#6b7280',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
    },
    credFieldRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 5,
        padding: '4px 8px',
    },
    credFieldValue: {
        flex: 1,
        fontSize: 12,
        color: '#f3f4f6',
        fontFamily: "'DM Mono', 'Courier New', monospace",
        wordBreak: 'break-all',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    copyBtn: {
        background: 'none',
        border: 'none',
        color: '#a78bfa',
        cursor: 'pointer',
        fontSize: 13,
        padding: '0 2px',
        flexShrink: 0,
        lineHeight: 1,
    },
    credMeta: {
        fontSize: 11,
        color: '#6b7280',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
    },
    credStatus: {
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 20,
    },
    credAdminBadge: {
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 20,
        background: 'rgba(167,139,250,0.2)',
        color: '#c4b5fd',
    },

    // ── User Data ─────────────────────────────────────────────
    userDataRow: {
        width: '100%',
        background: 'none',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        borderRadius: 6,
        color: '#d1d5db',
        textAlign: 'left',
        transition: 'background 0.1s',
    },
    userDataRowActive: {
        background: 'rgba(167,139,250,0.15)',
    },
    userDataInfo: {
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
    },
    userDataName: {
        fontSize: 12.5,
        fontWeight: 500,
        color: '#e5e7eb',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    userDataSub: {
        fontSize: 11,
        color: '#6b7280',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },

    // ── Bottom ────────────────────────────────────────────────
    sidebarBottom: {
        padding: '12px 14px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
    },
    adminUser: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
    },
    adminAvatar: {
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    adminInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
    },
    adminName: {
        fontSize: 13,
        fontWeight: 600,
        color: '#f3f4f6',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    adminRole: {
        fontSize: 11,
        color: '#6b7280',
    },
    signOutBtn: {
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 7,
        color: '#9ca3af',
        fontSize: 12.5,
        padding: '7px 12px',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'background 0.15s',
        width: '100%',
    },
    content: {
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
    },
};