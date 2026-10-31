import type { ChapterSummaryDto } from '@bookverse/shared';

/** Дорожка без WebGL: те же данные и те же вехи, только в плоском виде. */
export function FlatJourney({ percent, chapters, totalChars, completed, finished }: { percent: number; chapters: ChapterSummaryDto[]; totalChars: number; completed: number[]; finished: boolean }) {
  return (
    <div className="flat-journey" aria-hidden="true">
      <div className="flat-road">
        {chapters.map((chapter) => (
          <span
            key={chapter.order}
            className={`flat-flag ${completed.includes(chapter.order) ? 'is-done' : ''}`}
            style={{ left: `${((chapter.charStart + chapter.charLength) / Math.max(1, totalChars)) * 100}%` }}
          />
        ))}
        <span className={`flat-runner ${finished ? 'is-finished' : ''}`} style={{ left: `${Math.min(100, percent)}%` }}>🏃</span>
      </div>
    </div>
  );
}
