import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/projects', label: 'Projects' },
  { to: '/findings', label: 'Findings' },
];

export default function AppShell() {
  const { email, roleLabel, signOut } = useAuth();

  return (
    <div className="qd-shell">
      <aside className="qd-sidebar">
        <div className="qd-sidebar-brand">Quality Dashboard</div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `qd-nav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </aside>
      <div className="qd-main">
        <header className="qd-topbar">
          <span className="qd-topbar-title">Quality Dashboard</span>
          <div className="qd-topbar-meta">
            <span>{email}</span>
            <span className="qd-role-chip">{roleLabel}</span>
            <button className="qd-button qd-button-secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <main className="qd-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
