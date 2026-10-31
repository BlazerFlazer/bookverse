import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/700.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource-variable/manrope/index.css';
import '@fontsource-variable/nunito/index.css';
import './styles/index.css';
import './styles/world.css';
import './styles/reader.css';
import './styles/pages.css';
import './styles/demo.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

const Shell = lazy(() => import('./Shell.tsx').then((m) => ({ default: m.Shell })));
const JoinPage = lazy(() => import('./demo/JoinPage.tsx').then((m) => ({ default: m.JoinPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } },
});

// Страница зрителя отдельная: телефону в зале не нужно загружать 3D-мир.
const isAudience = window.location.pathname.startsWith('/join');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {isAudience ? (
        <JoinPage />
      ) : (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </QueryClientProvider>
      )}
    </Suspense>
  </StrictMode>,
);
