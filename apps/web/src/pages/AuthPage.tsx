import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.ts';
import { playPageTurn } from '../lib/sound.ts';
import { useMe } from '../lib/queries.ts';
import { PageLeaf } from '../reader/PageLeaf.tsx';
import { toast } from '../stores/toasts.ts';
import { useWorld } from '../stores/world.ts';
import { IconEye, IconEyeOff } from '../ui/Icons.tsx';
import { stageChamber } from '../world/director.ts';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

const BENEFITS = ['Сохранить прогресс чтения', 'Хранить выученные слова', 'Открывать достижения', 'Собрать личную библиотеку', 'Подключить Telegram', 'Продолжить на другом устройстве'];

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      {children}
      {error && <em role="alert">{error}</em>}
    </label>
  );
}

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="auth-password">
      <input id={id} className="field" type={visible ? 'text' : 'password'} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} />
      <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}>
        {visible ? <IconEyeOff width={18} height={18} /> : <IconEye width={18} height={18} />}
      </button>
    </span>
  );
}

function LeftPage() {
  return (
    <div className="auth-page auth-left">
      <p className="eyebrow">Личная комната чтения</p>
      <h1 className="display">BOOKVERSE</h1>
      <p className="auth-lead">Гостем можно читать сразу. Аккаунт нужен, чтобы:</p>
      <ul>{BENEFITS.map((b) => <li key={b}>{b}</li>)}</ul>
      <Link to="/" className="auth-skip">Продолжить как гость</Link>
    </div>
  );
}

function Forms({ mode, setMode, resetToken }: { mode: Mode; setMode: (mode: Mode) => void; resetToken: string | null }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: me } = useMe();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const submit = useMutation({
    mutationFn: async (): Promise<string | null> => {
      setErrors({});
      setNotice('');
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: { displayName, email, password, confirmPassword } });
        return 'Добро пожаловать в BOOKVERSE';
      }
      if (mode === 'login') {
        const result = await api<{ mergedGuest: boolean }>('/auth/login', { method: 'POST', body: { email, password, remember } });
        return result.mergedGuest ? 'С возвращением! Гостевой прогресс добавлен в аккаунт.' : 'С возвращением';
      }
      if (mode === 'reset') {
        await api('/auth/reset', { method: 'POST', body: { token: resetToken, password } });
        setNotice('Пароль изменён. Теперь войдите с новым паролем.');
        setMode('login');
        return null;
      }
      const result = await api<{ available: boolean }>('/auth/forgot', { method: 'POST', body: { email } });
      setNotice(
        result.available
          ? 'Если такой адрес зарегистрирован, письмо со ссылкой уже в пути.'
          : 'Отправка писем на этом сервере не настроена, поэтому письмо не будет отправлено. Обратитесь к администратору школы.',
      );
      return null;
    },
    onSuccess: async (message) => {
      if (message === null) return;
      client.clear();
      toast(message);
      await navigate('/me');
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors({ ...(error.fields ?? {}), _: error.fields ? '' : error.message });
      else setErrors({ _: 'Что-то пошло не так. Попробуйте ещё раз.' });
    },
  });

  const titles: Record<Mode, string> = { login: 'Вход', register: 'Регистрация', forgot: 'Восстановление пароля', reset: 'Новый пароль' };

  return (
    <form
      className="auth-page auth-right"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
      noValidate
    >
      <h2 className="display">{titles[mode]}</h2>
      {me?.user?.isGuest && mode === 'register' && <p className="auth-note">Весь гостевой прогресс перейдёт в новый аккаунт.</p>}
      {errors._ && <p className="auth-error" role="alert">{errors._}</p>}
      {notice && <p className="auth-note" role="status">{notice}</p>}

      {mode === 'register' && (
        <Field label="Имя на сайте" error={errors.displayName}>
          <input className="field" value={displayName} autoComplete="nickname" onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
      )}
      {mode !== 'reset' && (
        <Field label="Почта" error={errors.email}>
          <input className="field" type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
        </Field>
      )}
      {mode !== 'forgot' && (
        <Field label="Пароль" error={errors.password}>
          <PasswordInput id="auth-password" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
      )}
      {mode === 'register' && (
        <Field label="Повторите пароль" error={errors.confirmPassword}>
          <PasswordInput id="auth-confirm" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        </Field>
      )}
      {mode === 'login' && (
        <div className="auth-row">
          <label className="auth-check">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Запомнить меня
          </label>
          <button type="button" className="auth-link" onClick={() => setMode('forgot')}>Забыли пароль?</button>
        </div>
      )}

      <button type="submit" className="btn btn-primary auth-submit" disabled={submit.isPending}>
        {submit.isPending ? 'Секунду…' : mode === 'register' ? 'Создать аккаунт' : mode === 'login' ? 'Войти' : mode === 'reset' ? 'Сохранить пароль' : 'Отправить ссылку'}
      </button>

      <p className="auth-switch">
        {mode === 'register' ? (
          <>Уже есть аккаунт? <button type="button" className="auth-link" onClick={() => setMode('login')}>Войти</button></>
        ) : mode === 'login' ? (
          <>Впервые здесь? <button type="button" className="auth-link" onClick={() => setMode('register')}>Регистрация</button></>
        ) : (
          <button type="button" className="auth-link" onClick={() => setMode('login')}>Вернуться ко входу</button>
        )}
      </p>
    </form>
  );
}

/** Статичная копия формы для листа в полёте: настоящая форма сразу открыта под ним. */
function PageShadow({ title }: { title: string }) {
  return (
    <div className="auth-page auth-right">
      <h2 className="display">{title}</h2>
    </div>
  );
}

export function AuthPage() {
  const setStage = useWorld((s) => s.setStage);
  const webgl = useWorld((s) => s.webgl);
  const reduced = useWorld((s) => s.reducedMotion);
  const [params] = useSearchParams();
  const resetToken = params.get('reset');
  const [mode, setModeState] = useState<Mode>(resetToken ? 'reset' : 'register');
  const [turn, setTurn] = useState<{ key: number; title: string } | null>(null);
  const counter = useRef(0);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const layout = useMemo(() => {
    const two = size.width >= 860;
    const pageWidth = two ? Math.min(450, (size.width - 64) / 2) : Math.min(460, size.width - 24);
    const height = Math.min(600, size.height - 40);
    return { two, pageWidth, height, width: two ? pageWidth * 2 : pageWidth };
  }, [size]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    setStage('chamber');
    if (webgl) {
      stageChamber({ width: layout.width, height: layout.height, centerX: size.width / 2, centerY: size.height / 2 });
    }
  }, [setStage, webgl, layout, size]);

  const setMode = (next: Mode) => {
    if (layout.two && !reduced) {
      playPageTurn();
      counter.current += 1;
      setTurn({ key: counter.current, title: next === 'register' ? 'Регистрация' : next === 'login' ? 'Вход' : 'Восстановление пароля' });
    }
    setModeState(next);
  };

  return (
    <div className="auth-root">
      <div className="auth-book" style={{ width: layout.width, minHeight: layout.height }}>
        {layout.two && <LeftPage />}
        <Forms mode={mode} setMode={setMode} resetToken={resetToken} />
        {turn && (
          <div className="rd-turn auth-turn" style={{ left: layout.pageWidth, width: layout.pageWidth }}>
            <PageLeaf
              key={turn.key}
              width={layout.pageWidth}
              height={layout.height}
              direction="next"
              sweep={180}
              flexible
              duration={0.66}
              onDone={() => setTurn(null)}
              front={<PageShadow title={turn.title} />}
              back={<div className="auth-page auth-left" />}
            />
          </div>
        )}
      </div>
    </div>
  );
}
