import { invalidate } from '@react-three/fiber';
import { useEffect } from 'react';
import { useWorld } from '../stores/world.ts';
import { stageBackdrop } from '../world/director.ts';

/** Страницы поверх зала: сцена замирает под размытием и не занимает GPU. */
export function useBackdrop(): void {
  const setStage = useWorld((s) => s.setStage);
  useEffect(() => {
    setStage('backdrop');
    stageBackdrop();
    // Один кадр, чтобы сцена успела принять новое положение камеры.
    const timer = setTimeout(() => invalidate(), 60);
    return () => clearTimeout(timer);
  }, [setStage]);
}
