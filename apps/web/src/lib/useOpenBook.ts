import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookSummaryDto } from '@bookverse/shared';
import { computeSpread } from '../reader/layout.ts';
import { useWorld } from '../stores/world.ts';
import { playBookTransition } from '../world/director.ts';
import { bookThickness, slotFor } from '../world/library/ShelfBooks.tsx';
import { rt } from '../world/runtime.ts';

let locked = false;

/** Открытие книги с полки или из каталога. Повторные клики во время анимации игнорируются. */
export function useOpenBook(catalog: BookSummaryDto[]) {
  const navigate = useNavigate();
  return useCallback(
    (book: BookSummaryDto) => {
      const world = useWorld.getState();
      if (locked || world.stage !== 'library') return;
      const go = () => {
        locked = false;
        void navigate(`/read/${book.publicId}`, { state: { cinematic: true } });
      };
      if (!world.webgl) {
        go();
        return;
      }
      locked = true;
      world.setFlying(book);
      world.setStage('transition');
      const index = Math.max(0, catalog.findIndex((b) => b.publicId === book.publicId));
      const spread = computeSpread(window.innerWidth, window.innerHeight, 1);
      const ratio = Math.min(0.92, Math.max(0.06, (book.progress?.percent ?? 0) / 100));
      // Кадр на смену текстур обложки: иначе книга на миг появится с чужой обложкой.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          rt.cam.freeLook = 0;
          playBookTransition({
            slot: slotFor(index),
            thickness: bookThickness(book.totalWords),
            openRatio: ratio,
            rect: {
              width: spread.width,
              height: spread.height,
              centerX: spread.left + spread.width / 2,
              centerY: spread.top + spread.height / 2,
            },
            onReadyForReader: go,
          });
        }),
      );
    },
    [catalog, navigate],
  );
}
