import { useEffect } from 'react';
import { motion } from 'motion/react';
import type { BookDetailDto, BookmarkDto } from '@bookverse/shared';
import { IconCheck, IconClose, IconTrash } from '../ui/Icons.tsx';

export function TocPanel({
  book,
  currentOrder,
  completed,
  bookmarks,
  onChapter,
  onBookmark,
  onDeleteBookmark,
  onClose,
}: {
  book: BookDetailDto;
  currentOrder: number;
  completed: number[];
  bookmarks: BookmarkDto[];
  onChapter: (order: number) => void;
  onBookmark: (bookmark: BookmarkDto) => void;
  onDeleteBookmark: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.aside
      className="rd-sheet rd-sheet-left scroll-area"
      role="dialog"
      aria-label="Оглавление"
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.28, ease: [0.22, 0.72, 0.18, 1] }}
    >
      <div className="rd-sheet-head">
        <h2 className="display">Оглавление</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><IconClose /></button>
      </div>
      <ol className="toc-list">
        {book.chapters.map((chapter) => (
          <li key={chapter.order}>
            <button type="button" className="toc-item" aria-current={chapter.order === currentOrder ? 'true' : undefined} onClick={() => onChapter(chapter.order)}>
              <span>{chapter.title}</span>
              {completed.includes(chapter.order) && <IconCheck width={16} height={16} aria-label="Прочитано" />}
            </button>
          </li>
        ))}
      </ol>
      <h3 className="rd-sheet-title">Закладки</h3>
      {bookmarks.length === 0 ? (
        <p className="rd-sheet-note">Закладок пока нет. Значок закладки на панели отмечает текущую страницу.</p>
      ) : (
        <ul className="toc-list">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="toc-mark">
              <button type="button" className="toc-item" onClick={() => onBookmark(bookmark)}>
                <span>
                  <em>Глава {bookmark.chapterOrder}</em>
                  {bookmark.snippet}
                </span>
              </button>
              <button type="button" className="icon-btn" onClick={() => onDeleteBookmark(bookmark.id)} aria-label="Удалить закладку">
                <IconTrash width={16} height={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.aside>
  );
}
