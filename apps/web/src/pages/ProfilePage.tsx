import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { QuoteDto, TelegramLinkDto } from '@bookverse/shared';
import { api, ApiError } from '../lib/api.ts';
import { useCatalog, useMe, useProfile } from '../lib/queries.ts';
import { toast } from '../stores/toasts.ts';
import { BookCover } from '../ui/Catalog.tsx';
import { IconTelegram, IconTrash } from '../ui/Icons.tsx';
import { TopBar } from '../ui/TopBar.tsx';
import { useBackdrop } from './usePageStage.ts';

function TelegramCard({ linked, username, isGuest }: { linked: boolean; username: string | null; isGuest: boolean }) {
  const client = useQueryClient();
  const [link, setLink] = useState<TelegramLinkDto | null>(null);

  const create = useMutation({
    mutationFn: () => api<TelegramLinkDto>('/telegram/link-token', { method: 'POST', body: {} }),
    onSuccess: setLink,
    onError: (error) => toast('Не удалось создать ссылку', error instanceof ApiError ? error.message : undefined, 'error'),
  });
  const unlink = useMutation({
    mutationFn: () => api('/telegram/link', { method: 'DELETE' }),
    onSuccess: () => {
      setLink(null);
      void client.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return (
    <section className="tg-card glass" aria-label="Telegram">
      <IconTelegram width={28} height={28} />
      <div className="tg-body">
        <h3 className="display">BOOKVERSE в Telegram</h3>
        {linked ? (
          <>
            <p>Подключён{username ? ` аккаунт @${username}` : ''}. Бот продолжает чтение и повторяет слова с вами.</p>
            <button type="button" className="btn btn-ghost" onClick={() => unlink.mutate()}>Отключить</button>
          </>
        ) : isGuest ? (
          <p>Чтобы подключить бота, сначала <Link to="/auth">создайте аккаунт</Link>. Весь ваш прогресс сохранится.</p>
        ) : link ? (
          link.url ? (
            <>
              <p>Откройте ссылку в Telegram. Она одноразовая и действует 10 минут.</p>
              <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Открыть бота</a>
            </>
          ) : (
            <>
              <p>Бот на этом сервере не настроен: не указан TELEGRAM_BOT_USERNAME. Для проверки в симуляторе отправьте команду:</p>
              <code className="tg-code" data-testid="link-code">/start link_{link.code}</code>
            </>
          )
        ) : (
          <>
            <p>Продолжайте чтение, ищите книги по коду и повторяйте слова прямо в мессенджере. Сайт работает и без этого.</p>
            <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>Подключить Telegram</button>
          </>
        )}
      </div>
    </section>
  );
}

export function ProfilePage() {
  useBackdrop();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: me, isLoading } = useMe();
  const user = me?.user;
  const { data: profile } = useProfile(Boolean(user));
  const { data: catalog } = useCatalog();
  const { data: quotes } = useQuery({ queryKey: ['quotes'], queryFn: () => api<QuoteDto[]>('/quotes'), enabled: Boolean(user) });

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST', body: {} }),
    onSuccess: async () => {
      client.clear();
      await navigate('/');
    },
  });

  const started = (catalog?.books ?? []).filter((b) => b.progress);
  const reading = started.filter((b) => b.progress?.status === 'reading');
  const done = started.filter((b) => b.progress?.status === 'completed');

  if (!isLoading && !user) {
    return (
      <div className="page-shell">
        <TopBar />
        <div className="page-wrap">
          <h1 className="display page-title">Моя библиотека</h1>
          <p className="page-lead">Здесь появятся ваши книги, слова и достижения. Начните читать прямо сейчас или создайте аккаунт, чтобы ничего не потерять.</p>
          <div className="guest-actions">
            <Link to="/" className="btn btn-primary">Выбрать книгу</Link>
            <Link to="/auth" className="btn btn-ghost">Создать аккаунт</Link>
          </div>
        </div>
      </div>
    );
  }

  const level = profile?.level;
  const stats = profile?.stats;

  return (
    <div className="page-shell">
      <TopBar />
      <div className="page-wrap">
        <p className="eyebrow">{level?.rank ?? ' '}</p>
        <h1 className="display page-title">Моя библиотека</h1>

        {level && (
          <div className="level-row">
            <span className="level-badge">{level.level}</span>
            <div className="level-track">
              <p>
                <b>{profile?.user.displayName}</b> · {profile?.user.xp} XP
                {level.nextRank ? ` · следующий ранг: ${level.nextRank}` : ''}
              </p>
              <div className="progress-track" role="progressbar" aria-valuenow={level.xpIntoLevel} aria-valuemax={level.xpForLevel} aria-label="Опыт до следующего уровня">
                <div className="progress-fill" style={{ width: `${(level.xpIntoLevel / level.xpForLevel) * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        {user?.isGuest && (
          <p className="guest-banner">
            Вы читаете как гость. <Link to="/auth">Создайте аккаунт</Link>, чтобы сохранить прогресс, слова и достижения и продолжать на другом устройстве.
          </p>
        )}

        <div className="stat-grid">
          <div className="stat"><span className="stat-value">{stats?.booksOpened ?? 0}</span><span className="stat-label">Открыто книг</span></div>
          <div className="stat"><span className="stat-value">{stats?.booksInProgress ?? 0}</span><span className="stat-label">Читаю сейчас</span></div>
          <div className="stat"><span className="stat-value">{stats?.booksCompleted ?? 0}</span><span className="stat-label">Прочитано</span></div>
          <div className="stat"><span className="stat-value">{stats?.savedWords ?? 0}</span><span className="stat-label">Слов в словаре</span></div>
          <div className="stat"><span className="stat-value">{stats?.masteredWords ?? 0}</span><span className="stat-label">Выучено слов</span></div>
          <div className="stat"><span className="stat-value">{stats?.quizzesCompleted ?? 0}</span><span className="stat-label">Пройдено заданий</span></div>
        </div>

        <h2 className="display section-title">Продолжить чтение</h2>
        {reading.length === 0 ? (
          <p className="empty-note">Начатых книг пока нет. <Link to="/">Выберите первую</Link>.</p>
        ) : (
          <div className="shelf-row">
            {reading.map((book) => (
              <Link key={book.publicId} className="shelf-item" to={`/read/${book.publicId}`}>
                <BookCover book={book} width={180} />
                <span className="book-card-title">{book.title}</span>
                <span className="progress-track"><span className="progress-fill block" style={{ width: `${book.progress?.percent ?? 0}%` }} /></span>
                <span className="book-card-meta">{Math.round(book.progress?.percent ?? 0)}% прочитано</span>
              </Link>
            ))}
          </div>
        )}

        {done.length > 0 && (
          <>
            <h2 className="display section-title">Прочитанные книги</h2>
            <div className="shelf-row">
              {done.map((book) => (
                <Link key={book.publicId} className="shelf-item is-done" to={`/read/${book.publicId}`}>
                  <BookCover book={book} width={180} />
                  <span className="book-card-title">{book.title}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        <h2 className="display section-title">Мои достижения</h2>
        <div className="badge-grid">
          {profile?.achievements.map((achievement) => (
            <div key={achievement.code} className={`badge ${achievement.unlockedAt ? 'is-earned' : ''}`} data-testid={achievement.unlockedAt ? `badge-${achievement.code}` : undefined}>
              <span className="badge-icon" aria-hidden="true">{achievement.icon}</span>
              <span className="badge-title">{achievement.title}</span>
              <span className="badge-note">{achievement.description}</span>
            </div>
          ))}
        </div>

        <h2 className="display section-title">Мои цитаты</h2>
        {!quotes || quotes.length === 0 ? (
          <p className="empty-note">Выделите фрагмент в книге и нажмите «В цитаты».</p>
        ) : (
          <div className="quote-list">
            {quotes.map((quote) => (
              <blockquote key={quote.id}>
                <p>{quote.text}</p>
                <footer>
                  <Link to={`/read/${quote.publicId}?b=${quote.blockKey}&o=0`}>{quote.bookTitle}, глава {quote.chapterOrder}</Link>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Удалить цитату"
                    onClick={() => void api(`/quotes/${quote.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['quotes'] }))}
                  >
                    <IconTrash width={16} height={16} />
                  </button>
                </footer>
              </blockquote>
            ))}
          </div>
        )}

        {profile && <TelegramCard linked={profile.telegram.linked} username={profile.telegram.username} isGuest={profile.user.isGuest} />}

        {user && !user.isGuest && (
          <button type="button" className="btn btn-ghost logout" onClick={() => logout.mutate()}>Выйти из аккаунта</button>
        )}
      </div>
    </div>
  );
}
