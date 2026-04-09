import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { login, register } from '../lib/api';
import styles from '../styles/Auth.module.css';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ identifier: '', username: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let data;
      if (mode === 'login') {
        // identifier = email or phone — user types either
        data = await login(form.identifier, form.password);
        signIn({
          email: data.user.email,
          phone: data.user.phone,
          username: data.user.username,
        });
      } else {
        // register — email or phone required, both optional but at least one
        if (!form.identifier) {
          setError('Enter an email or phone number');
          setLoading(false);
          return;
        }
        const isEmail = form.identifier.includes('@');
        data = await register({
          email: isEmail ? form.identifier : '',
          phone: isEmail ? '' : form.identifier,
          username: form.username,
          password: form.password,
        });
        signIn({
          email: isEmail ? form.identifier : '',
          phone: isEmail ? '' : form.identifier,
          username: data.username,
        });
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.leftContent}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>◈</span>
            <span className="app-name" style={{ fontSize: 22 }}>AI Meeting Assistant</span>
          </div>
          <h1 className={styles.headline}>
            Every meeting.<br />
            Every decision.<br />
            <span className={styles.accent}>Captured.</span>
          </h1>
          <p className={styles.sub}>
            Record live, transcribe instantly, and let AI surface every action point — so you never lose what matters.
          </p>
          <div className={styles.features}>
            {['Live audio transcription', 'AI action point extraction', 'Editable smart notes', 'Everything searchable'].map(f => (
              <div key={f} className={styles.featureItem}>
                <span className={styles.check}>✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.card + ' card'}>
          <div className={styles.tabs}>
            <button
              className={styles.tab + (mode === 'login' ? ' ' + styles.tabActive : '')}
              onClick={() => { setMode('login'); setError(''); }}
            >Sign In</button>
            <button
              className={styles.tab + (mode === 'register' ? ' ' + styles.tabActive : '')}
              onClick={() => { setMode('register'); setError(''); }}
            >Create Account</button>
          </div>

          <form onSubmit={submit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>
                {mode === 'login' ? 'Email or Phone Number' : 'Email or Phone Number'}
              </label>
              <input
                className="input"
                name="identifier"
                type="text"
                required
                value={form.identifier}
                onChange={handle}
                placeholder={mode === 'login' ? 'email or phone number' : 'you@company.com or +91...'}
              />
            </div>

            {mode === 'register' && (
              <div className={styles.field}>
                <label className={styles.label}>Username</label>
                <input
                  className="input"
                  name="username"
                  required
                  value={form.username}
                  onChange={handle}
                  placeholder="Your name"
                />
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input
                className="input"
                name="password"
                type="password"
                required
                value={form.password}
                onChange={handle}
                placeholder="••••••••"
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button className={'btn btn-primary ' + styles.submit} type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}