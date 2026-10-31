import gsap from 'gsap';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

const STRIPS = 11;

export interface LeafProps {
  width: number;
  height: number;
  front: ReactNode;
  back: ReactNode;
  /** next: лист уходит влево; prev: возвращается справа налево наоборот. */
  direction: 'next' | 'prev';
  /** Шарнир: у корешка на развороте или у края страницы на телефоне. */
  sweep: number;
  flexible: boolean;
  duration: number;
  onDone: () => void;
}

/**
 * Лист из вложенных полос. Каждая полоса повёрнута относительно предыдущей, поэтому вместе они
 * дают настоящий изгиб. Текст остаётся текстом: canvas и снимки страницы здесь не нужны.
 */
export function PageLeaf({ width, height, front, back, direction, sweep, flexible, duration, onDone }: LeafProps) {
  const root = useRef<HTMLDivElement>(null);
  const count = flexible ? STRIPS : 1;
  const stripWidth = width / count;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const state = { t: 0 };
    const apply = () => {
      const t = direction === 'next' ? state.t : 1 - state.t;
      const lift = Math.sin(Math.PI * t);
      // Свободный край отстаёт от движения листа.
      const lag = direction === 'next' ? 1 : -1;
      const bend = flexible ? (lift * 62 * lag) / count : 0;
      element.style.setProperty('--leaf-root', `${-sweep * t - (bend * count) / 2}deg`);
      element.style.setProperty('--leaf-bend', `${bend}deg`);
      element.style.setProperty('--leaf-shade', String(lift * 0.42));
    };
    apply();
    const tween = gsap.to(state, { t: 1, duration, ease: 'power2.inOut', onUpdate: apply, onComplete: onDone });
    return () => {
      tween.kill();
    };
    // Лист живёт один поворот: новые пропсы приходят только с новым key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderStrip = (index: number): ReactNode => (
    <div
      className="leaf-strip"
      style={
        {
          width: stripWidth + 0.6,
          left: index === 0 ? 0 : stripWidth,
          transform: index === 0 ? 'rotateY(var(--leaf-root))' : 'rotateY(var(--leaf-bend))',
          '--strip-light': Math.sin((Math.PI * (index + 0.5)) / count).toFixed(3),
        } as React.CSSProperties
      }
    >
      <div className="leaf-face leaf-front">
        <div className="leaf-content" style={{ width, transform: `translateX(${-index * stripWidth}px)` }}>{front}</div>
      </div>
      <div className="leaf-face leaf-back">
        <div className="leaf-content" style={{ width, transform: `translateX(${-(count - 1 - index) * stripWidth}px)` }}>{back}</div>
      </div>
      {index < count - 1 && renderStrip(index + 1)}
    </div>
  );

  return (
    <div ref={root} className="leaf" style={{ width, height }}>
      {renderStrip(0)}
    </div>
  );
}
