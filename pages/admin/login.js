import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/auth';
import { login } from '../../lib/api';
import styles from '../../styles/Admin.module.css';

export default function AdminLogin() {
    const { signIn } = useAuth();
    const router = useRouter();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await login(identifier, password);
            if (!data.user?.isAdmin) {
                setError('Access denied. This login is for admins only.');
                return;
            }
            signIn(data.user);
            router.push('/admin');
        } catch (err) {
            setError(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.loginPage}>
            <div className={styles.loginCard}>
                <div className={styles.loginIcon}>⬡</div>
                <h1 className={styles.loginTitle}>Admin Access</h1>
                <p className={styles.loginSub}>Sign in with your admin credentials to continue.</p>

                {error && <div className={styles.errorBox}>{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Email or Username</label>
                        <input
                            className="input"
                            style={{ width: '100%' }}
                            placeholder="admin@example.com"
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Password</label>
                        <input
                            className="input"
                            style={{ width: '100%' }}
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: 8 }}
                        type="submit"
                        disabled={loading}
                    >
                        {loading ? <><span className="spinner" /> Signing in…</> : 'Sign in to Admin'}
                    </button>
                </form>

                <button
                    className="btn btn-ghost"
                    style={{ width: '100%', marginTop: 12, fontSize: 13 }}
                    onClick={() => router.push('/')}
                >
                    ← Back to main app
                </button>
            </div>
        </div>
    );
}