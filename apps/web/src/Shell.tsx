import { motion, AnimatePresence } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { BookSummaryDto } from '@bookverse/shared';
import { useCatalog, useMe } from './lib/queries.ts';
import { useRealtime } from './lib/realtime.ts';
import { useOpenBook } from './lib/useOpenBook.ts';
import { WorldPage } from './pages/WorldPage.tsx';
import { useWorld } from './stores/world.ts';
import { DemoDock } from './demo/DemoDock.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { WebGLBoundary } from './ui/WebGLBoundary.tsx';
import { prepareAssets } from './world/assets.ts';

const WorldCanvas = lazy(() => import('./world/WorldCanvas.tsx').then((m) => ({ default: m.WorldCanvas })));
const ReaderPage = lazy(() => import('./pages/ReaderPage.tsx').then((m) => ({ default: m.ReaderPage })));
const VocabularyPage = lazy(() => import('./pages/VocabularyPage.tsx').then((m) => ({ default: m.VocabularyPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.tsx').then((m) => ({ default: m.ProfilePage })));
const AuthPage = lazy(() => import('./pages/AuthPage.tsx').then((m) => ({ default: m.AuthPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })));
const DemoPage = lazy(() => import('./demo/DemoPage.tsx').then((m) => ({ default: m.DemoPage })));

function LoadingScreen() {
  const progress = useWorld((s) => s.loadProgress);
  const label = useWorld((s) => s.loadLabel);
  return (
    <motion.div className="loading" exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
      <p className="display loading-mark">BOOKVERSE</p>
      <div className="loading-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Загрузка">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="loading-label">{label}</p>
    </motion.div>
  );
}

/** Запасной фон на случай, если WebGL недоступен: сайт работает полностью и без 3D. */
function FlatBackdrop() {
  return <div className="flat-backdrop" aria-hidden="true" />;
}

export function Shell() {
  const webgl = useWorld((s) => s.webgl);
  const stage = useWorld((s) => s.stage);
  const sceneReady = useWorld((s) => s.sceneReady);
  const setStage = useWorld((s) => s.setStage);
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<BookSummaryDto | null>(null);

  const { data: me } = useMe();
  useRealtime(me?.user?.id);

  const { data: catalog } = useCatalog();
  const books = useMemo(() => catalog?.books ?? [], [catalog]);
  const openBook = useOpenBook(books);

  useEffect(() => {
    prepareAssets()
      .then(() => setReady(true))
      .catch((error: unknown) => {
        // Сбой подготовки 3D не закрывает доступ к книгам: переходим в плоский режим.
        console.error(error);
        useWorld.setState({ webgl: false });
        setFailed(true);
        setReady(true);
      });
  }, []);

  const showWorld = ready && webgl && !failed;

  // Код читалки загружается заранее, чтобы в конце перелёта книги не было паузы.
  useEffect(() => {
    if (!ready) return;
    void import('./pages/ReaderPage.tsx');
    void import('./journey/JourneyTrack.tsx');
  }, [ready]);

  // Первая стадия зависит от адреса: глубокая ссылка не должна проигрывать интро.
  const worldSettled = ready && (!showWorld || sceneReady);
  useEffect(() => {
    if (!worldSettled || useWorld.getState().stage !== 'loading') return;
    setStage(location.pathname === '/' ? 'library' : 'backdrop');
  }, [worldSettled, location.pathname, setStage]);

  return (
    <>
      {showWorld ? (
        <WebGLBoundary
          fallback={<FlatBackdrop />}
          onFail={() => {
            useWorld.setState({ webgl: false });
            setStage(location.pathname === '/' ? 'library' : 'backdrop');
          }}
        >
          <Suspense fallback={null}>
            <WorldCanvas
              books={books}
              onPick={openBook}
              onHover={setHovered}
              onFocus={(side, bay) => window.dispatchEvent(new CustomEvent('bookverse:focus-bay', { detail: { side, bay } }))}
            />
          </Suspense>
        </WebGLBoundary>
      ) : (
        ready && <FlatBackdrop />
      )}
      {location.pathname === '/' && stage !== 'transition' && <div className="vignette" />}
      <div id="whiteout" className="whiteout" />

      {/* Страницы ставят сцену в своё положение, поэтому появляются только после прогрева */}
      {worldSettled && (
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<WorldPage onRead={openBook} hovered={hovered} />} />
            <Route path="/read/:publicId" element={<ReaderPage />} />
            <Route path="/words" element={<VocabularyPage />} />
            <Route path="/me" element={<ProfilePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      )}
      {worldSettled && <DemoDock />}
      <Toasts />
      <AnimatePresence>{stage === 'loading' && <LoadingScreen key="loading" />}</AnimatePresence>
    </>
  );
}
