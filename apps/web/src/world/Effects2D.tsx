import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useWorld } from '../stores/world.ts';

/** Постобработка только на сильных профилях: на встроенной графике свечение дают спрайты. */
export function Effects2D() {
  const bloom = useWorld((s) => s.quality.bloom);
  if (!bloom) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom intensity={0.5} luminanceThreshold={0.82} luminanceSmoothing={0.3} mipmapBlur radius={0.7} />
    </EffectComposer>
  );
}
