import { useAuth } from '../lib/auth';
import { useRouter } from 'next/router';
import styles from '../styles/Navbar.module.css';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = () => {
    signOut();
    router.push('/');
  };

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <span className={styles.icon}>◈</span>
        <span className={'app-name ' + styles.name}>AI Meeting Assistant</span>
      </div>
      <div className={styles.right}>
        {user && (
          <>
            <span className={styles.user}>
              <span className={styles.avatar}>{user.username?.[0]?.toUpperCase() || 'U'}</span>
              {user.username}
            </span>
            <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: 13 }}>
              Sign Out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
