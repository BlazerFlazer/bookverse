import { NavLink, Link } from 'react-router-dom';
import { useMe } from '../lib/queries.ts';
import { useWorld } from '../stores/world.ts';
import { IconMute, IconSound } from './Icons.tsx';

export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="BOOKVERSE, на главную">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 9c-3-2-7-2-11-1v16c4-1 8-1 11 1 3-2 7-2 11-1V8c-4-1-8-1-11 1zm0 0v16" />
      </svg>
      <span>BOOKVERSE</span>
    </Link>
  );
}

export function TopBar() {
  const { data } = useMe();
  const soundOn = useWorld((s) => s.soundOn);
  const setSound = useWorld((s) => s.setSound);
  const user = data?.user;

  return (
    <header className="topbar">
      <Wordmark />
      <nav className="topbar-nav" aria-label="Основная навигация">
        <NavLink to="/" end>Библиотека</NavLink>
        <NavLink to="/words">Мой словарь</NavLink>
        <NavLink to="/me">Моя библиотека</NavLink>
        <NavLink to="/settings">Настройки</NavLink>
      </nav>
      <div className="topbar-side">
        <button type="button" className="icon-btn" aria-pressed={soundOn} aria-label={soundOn ? 'Выключить звук' : 'Включить звук'} onClick={() => setSound(!soundOn)}>
          {soundOn ? <IconSound /> : <IconMute />}
        </button>
        {user && !user.isGuest ? (
          <Link to="/me" className="account-chip">
            <span className="account-level">{user.level}</span>
            <span>{user.displayName}</span>
          </Link>
        ) : (
          <Link to="/auth" className="btn btn-ghost">Войти</Link>
        )}
      </div>
    </header>
  );
}
