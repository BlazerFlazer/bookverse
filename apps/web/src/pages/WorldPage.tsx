import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { BookSummaryDto } from '@bookverse/shared';
import { useCatalog } from '../lib/queries.ts';
import { useWorld } from '../stores/world.ts';
import { Catalog } from '../ui/Catalog.tsx';
import { TopBar } from '../ui/TopBar.tsx';
import { focusBay, playIntro, returnHome, skipBookTransition, skipIntro, stageIntro, stageLibrary } from '../world/director.ts';
import { rt } from '../world/runtime.ts';

function IntroOverlay({ onWelcome }: { onWelcome: () => void }) {
  const setStage = useWorld((s) => s.setStage);
  const markIntroSeen = useWorld((s) => s.markIntroSeen);
  const stage = useWorld((s) => s.stage);
  const started = useRef(false);

  const finish = () => {
    markIntroSeen();
    setStage('library');
  };

  const begin = () => {
    if (started.current) return;
    started.current = true;
    setStage('cinematic');
    playIntro({ onWelcome, onDone: finish });
  };

  const skip = () => {
    skipIntro();
    finish();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && stage === 'intro') {
        event.preventDefault();
        begin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      {stage === 'intro' && (
        <button type="button" className="intro-hit" onClick={begin} aria-label="Открыть книгу и войти в библиотеку" />
      )}
      <AnimatePresence>
        {stage === 'intro' && (
          <motion.div className="intro-copy" exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.5 }}>
            <motion.p className="display intro-tagline" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6, duration: 1.4, ease: 'easeOut' }}>
              Каждая книга — новая вселенная.
            </motion.p>
            <motion.p className="intro-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5, duration: 1.2 }}>
              Нажмите, чтобы открыть.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
      <button type="button" className="btn btn-ghost skip" onClick={skip}>Пропустить</button>
    </>
  );
}

export function WorldPage({ onRead, hovered }: { onRead: (book: BookSummaryDto) => void; hovered: BookSummaryDto | null }) {
  const stage = useWorld((s) => s.stage);
  const introSeen = useWorld((s) => s.introSeen);
  const webgl = useWorld((s) => s.webgl);
  const setStage = useWorld((s) => s.setStage);
  const [expanded, setExpanded] = useState(true);
  const [focused, setFocused] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const booted = stage !== 'loading';

  // Первый визит ведёт в интро, остальные сразу в зал. Возврат из читалки зал уже подготовил сам.
  useEffect(() => {
    if (!booted || stage === 'cinematic' || stage === 'transition') return;
    if (!introSeen && webgl) {
      setStage('intro');
      stageIntro();
    } else if (stage !== 'library' || !rt.library.visible) {
      setStage('library');
      stageLibrary();
    }
    // Срабатывает при входе на страницу и при повторе интро из настроек.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introSeen, booted]);

  // Победитель голосования открывается той же анимацией, что и книга из каталога.
  const pendingBook = useWorld((s) => s.pendingBook);
  const setPendingBook = useWorld((s) => s.setPendingBook);
  const { data: catalog } = useCatalog();
  useEffect(() => {
    if (!pendingBook || stage !== 'library') return;
    const book = catalog?.books.find((b) => b.publicId === pendingBook);
    if (!book) return;
    const timer = setTimeout(() => {
      setPendingBook(null);
      onRead(book);
    }, 500);
    return () => clearTimeout(timer);
  }, [pendingBook, stage, catalog, onRead, setPendingBook]);

  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => setWelcome(false), 3800);
    return () => clearTimeout(timer);
  }, [welcome]);

  useEffect(() => {
    const onFocus = (event: Event) => {
      const { side, bay } = (event as CustomEvent<{ side: -1 | 1; bay: number }>).detail;
      focusBay(side, bay);
      setFocused(true);
    };
    window.addEventListener('bookverse:focus-bay', onFocus);
    return () => window.removeEventListener('bookverse:focus-bay', onFocus);
  }, []);

  const greeting = (
    <AnimatePresence>
      {welcome && (
        <motion.p className="display welcome" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.3, ease: 'easeOut' }}>
          Добро пожаловать в&nbsp;BOOKVERSE.
        </motion.p>
      )}
    </AnimatePresence>
  );

  if (stage === 'intro' || stage === 'cinematic') {
    return (
      <>
        <IntroOverlay onWelcome={() => setWelcome(true)} />
        {greeting}
      </>
    );
  }
  if (stage === 'transition') {
    return <button type="button" className="btn btn-ghost skip" onClick={skipBookTransition}>Сразу к чтению</button>;
  }
  if (stage !== 'library') return null;

  return (
    <div className="world-ui">
      {greeting}
      <TopBar />
      <AnimatePresence>
        {hovered && (
          <motion.div className="shelf-tooltip glass" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <span className="book-card-title">{hovered.title}</span>
            <span className="book-card-author">{hovered.author}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {focused && (
        <button
          type="button"
          className="btn btn-ghost return-home"
          onClick={() => {
            returnHome();
            setFocused(false);
          }}
        >
          Вернуться в центр зала
        </button>
      )}
      <Catalog onRead={onRead} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </div>
  );
}
