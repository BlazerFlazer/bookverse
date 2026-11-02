import { useEffect, useRef } from 'react';
import { useWorld } from '../stores/world.ts';
import { rt } from '../world/runtime.ts';

const STYLE_MS = 400;
const FRAME_MS = 50;
const DROPS = 46;

const css = (color: { getHexString: () => string }) => `#${color.getHexString()}`;

/**
 * Живая библиотека без 3D: арочное окно с дождём поверх тёплого зала. Менеджер атмосферы
 * работает и без холста, поэтому время суток и звук здесь те же, а рисует всё обычный браузер.
 */
export function FlatAtmosphere() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useWorld((s) => s.reducedMotion);

  useEffect(() => {
    const paint = () => {
      const style = root.current?.style;
      if (!style) return;
      const { frame } = rt.atmos;
      style.setProperty('--sky-top', css(frame.skyTop));
      style.setProperty('--sky-low', css(frame.skyLow));
      style.setProperty('--lamp', css(frame.lampColor));
      style.setProperty('--lamp-power', String(Math.min(1, frame.lamp)));
      style.setProperty('--window-power', String(Math.min(1, frame.window)));
    };
    paint();
    const timer = setInterval(paint, STYLE_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const { width, height } = element;
    const drops = Array.from({ length: DROPS }, () => ({ x: Math.random() * width, y: Math.random() * height, speed: 0.6 + Math.random() * 1.8, length: 8 + Math.random() * 18 }));

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgb(255 255 255 / 0.32)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const amount = Math.ceil(DROPS * Math.min(1, rt.atmos.rain));
      for (const drop of drops.slice(0, amount)) {
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x, drop.y + drop.length);
        drop.y += drop.speed * (1.4 + rt.atmos.rain);
        if (drop.y > height) {
          drop.y = -drop.length;
          drop.x = Math.random() * width;
        }
      }
      ctx.stroke();
    };

    draw();
    if (reducedMotion) return;
    const timer = setInterval(draw, FRAME_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  return (
    <div ref={root} className="flat-atmos" aria-hidden="true">
      <div className="flat-window">
        <canvas ref={canvas} width={320} height={520} />
      </div>
    </div>
  );
}
