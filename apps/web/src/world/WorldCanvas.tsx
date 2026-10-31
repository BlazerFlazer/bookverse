import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ACESFilmicToneMapping, AdditiveBlending, DirectionalLight, FogExp2, HemisphereLight, SpotLight, Sprite, SpriteMaterial } from 'three';
import type { BookSummaryDto } from '@bookverse/shared';
import { useWorld } from '../stores/world.ts';
import { assets, coverPreview, coverTexturesFor } from './assets.ts';
import { BookRig } from './book/BookRig.tsx';
import { CameraRig } from './CameraRig.tsx';
import { Effects2D } from './Effects2D.tsx';
import { GoldDust, LightShafts, Ribbons, Shockwave } from './fx/Effects.tsx';
import { FlyingBooks, PaperVortex } from './fx/PaperVortex.tsx';
import { Library, LibraryLights } from './library/Library.tsx';
import { SelectedSpot, ShelfBooks } from './library/ShelfBooks.tsx';
import { rt } from './runtime.ts';

const FOG_COLOR = '#1a0f09';
const WARMUP_LIMIT_MS = 15_000;
const CATALOG_WAIT_MS = 3000;
const WARM_COVERS = 6;

/** Туман и общий свет. В темноте зала туман закрывает всё: снятие тумана и есть проявление зала. */
function Atmosphere() {
  const { scene } = useThree();
  const fog = useMemo(() => new FogExp2(FOG_COLOR, 0.042), []);
  const key = useRef<SpotLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const fill = useRef<HemisphereLight>(null);

  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [fog, scene]);

  useFrame(() => {
    fog.density = rt.library.fog;
    const reveal = rt.library.reveal * rt.library.dim;
    const introLight = rt.intro.light;
    scene.environmentIntensity = 0.3 + introLight * 0.34 + rt.hero.glow * 0.12;
    if (key.current) key.current.intensity = introLight * 9 + rt.hero.glow * 0.5 + (rt.library.visible ? 0.3 * reveal : 0);
    if (rim.current) rim.current.intensity = introLight * 3.4 + reveal * 0.7;
    if (fill.current) fill.current.intensity = 0.08 + introLight * 0.14 + reveal * 1.15;
  });

  return (
    <>
      <hemisphereLight ref={fill} args={['#ffd9ad', '#2a1a10', 0.1]} />
      {/* Пятно света со спадом к краям: обложка проступает из темноты, а не освещена равномерно */}
      <spotLight ref={key} position={[-2.6, 4.2, 8.5]} angle={0.33} penumbra={1} decay={0} color="#ffdcaa" intensity={0} />
      <directionalLight ref={rim} position={[3, 2.5, -6]} color="#ffae62" intensity={0} />
    </>
  );
}

function Studio() {
  return (
    <Environment resolution={64} frames={1} background={false}>
      <color attach="background" args={['#120b07']} />
      <Lightformer intensity={3.4} color="#ffd9a6" position={[-3, 3, 4]} scale={[4, 3, 1]} />
      <Lightformer intensity={1.7} color="#ffb066" position={[4, 1, 2]} scale={[2, 5, 1]} />
      <Lightformer intensity={1} color="#fff0d8" position={[0, 5, -3]} rotation-x={Math.PI / 2} scale={[8, 2, 1]} />
      <Lightformer intensity={0.5} color="#a4693a" position={[0, -3, 2]} rotation-x={-Math.PI / 2} scale={[8, 4, 1]} />
      {/* Плоская фольга отражает то, что за камерой: без этой панели золото выглядит чёрным */}
      <Lightformer intensity={1.5} color="#ffd8a4" position={[0.6, 1, 6]} scale={[9, 7, 1]} />
    </Environment>
  );
}

/** Тёплое свечение за книгой отделяет её силуэт от тьмы. */
function IntroHalo() {
  const sprite = useRef<Sprite>(null);
  useFrame(() => {
    if (!sprite.current) return;
    const light = rt.intro.light;
    sprite.current.visible = light > 0.01;
    (sprite.current.material as SpriteMaterial).opacity = light * 0.5;
  });
  return (
    <sprite ref={sprite} position={[0.4, 0.5, -3.2]} scale={[17, 14, 1]} visible={false}>
      <spriteMaterial map={assets.glow} color="#b5642a" transparent blending={AdditiveBlending} depthWrite={false} fog={false} />
    </sprite>
  );
}

function Hero() {
  const flying = useWorld((s) => s.flying);
  const fanCount = useWorld((s) => (s.quality.level === 'low' ? 10 : 24));
  const textures = useMemo(() => (flying ? coverTexturesFor(flying) : assets.brand), [flying]);
  return (
    <BookRig
      textures={textures}
      leatherColor={flying?.cover.leatherDeep ?? '#2a140c'}
      paper={assets.paper}
      edge={assets.edge}
      glow={assets.glow}
      fanCount={fanCount}
    />
  );
}

/**
 * На Windows через D3D11 браузер достраивает шейдеры при первом реальном кадре каждого объекта,
 * поэтому в скрытый кадр включены все эффекты: иначе рывок пришёлся бы на вихрь страниц.
 */
function setEffectsVisible(on: boolean): void {
  const value = on ? 1 : 0;
  rt.vortex.opacity = value;
  rt.vortex.books = value;
  rt.vortex.burst = value;
  rt.ribbons.opacity = value;
  rt.shafts.opacity = value;
  rt.shock.progress = on ? 0.5 : 0;
  rt.hero.open = on ? 0.6 : 0;
  rt.hero.fan = on ? 0.5 : 0;
  rt.hero.innerLight = on ? 0.5 : 0;
  rt.intro.particles = value;
}

/**
 * Вся тяжёлая подготовка идёт на экране загрузки: обложки, шейдеры и один скрытый кадр всей сцены,
 * после которого геометрия и текстуры уже лежат в видеопамяти. Иначе эта работа случилась бы
 * в первом кадре зала и на выборе книги, то есть рывками прямо во время показа.
 */
function Warmup({ books }: { books: BookSummaryDto[] }) {
  const { gl, scene, camera } = useThree();
  const setLoad = useWorld((s) => s.setLoad);
  const setSceneReady = useWorld((s) => s.setSceneReady);
  const phase = useRef<'wait' | 'prepare' | 'draw' | 'done'>('wait');
  const frames = useRef(0);
  const drawn = useRef(0);
  const mountedAt = useRef(performance.now());

  const prepare = async () => {
    setLoad(93, 'Переплетаем обложки');
    for (const book of books.slice(0, WARM_COVERS)) {
      const { map, normalMap, ormMap, emissiveMap, spine } = coverTexturesFor(book);
      for (const texture of [map, normalMap, ormMap, emissiveMap, spine]) gl.initTexture(texture);
      coverPreview(book);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setLoad(96, 'Зажигаем лампы');
    const limit = new Promise<void>((resolve) => setTimeout(resolve, WARMUP_LIMIT_MS));
    await Promise.race([gl.compileAsync(scene, camera), limit]);
    rt.library.visible = true;
    rt.hero.visible = true;
    setEffectsVisible(true);
    phase.current = 'draw';
  };

  useFrame(() => {
    frames.current += 1;
    if (phase.current === 'wait') {
      // Окружению нужен кадр, чтобы попасть в сцену: от него зависят варианты шейдеров.
      const catalogKnown = books.length > 0 || performance.now() - mountedAt.current > CATALOG_WAIT_MS;
      if (frames.current < 3 || !catalogKnown) return;
      phase.current = 'prepare';
      void prepare();
    } else if (phase.current === 'draw') {
      drawn.current += 1;
      if (drawn.current < 3) return;
      phase.current = 'done';
      setEffectsVisible(false);
      rt.hero.visible = false;
      // На главной зал покажет стадия интро, а на остальных страницах он сразу служит фоном.
      rt.library.visible = window.location.pathname !== '/';
      setLoad(100, 'Готово');
      setSceneReady();
    }
  });
  return null;
}

function Scene({ books, onPick, onHover, onFocus }: WorldProps) {
  const quality = useWorld((s) => s.quality);
  return (
    <>
      <color attach="background" args={['#070506']} />
      <CameraRig />
      <Atmosphere />
      <LibraryLights count={quality.dynamicLights} />
      <SelectedSpot />
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
      <Library shelfBooks={quality.shelfBooks} dustCount={quality.dustCount}>
        <ShelfBooks books={books} onPick={onPick} onHover={onHover} onFocus={onFocus} />
      </Library>
      <IntroHalo />
      <Hero />
      <GoldDust count={Math.round(quality.dustCount * 0.8)} area={[12, 9, 8]} center={[0, 0, 1]} strength={() => rt.intro.particles} />
      <LightShafts position={[0, 1.6, 0.1]} />
      <Shockwave />
      <PaperVortex count={quality.paperCount} paper={assets.paper} fogColor={FOG_COLOR} />
      <FlyingBooks count={quality.flyingBooks} />
      <Ribbons count={3} />
      <Effects2D />
      <Warmup books={books} />
    </>
  );
}

export interface WorldProps {
  books: BookSummaryDto[];
  onPick: (book: BookSummaryDto) => void;
  onHover: (book: BookSummaryDto | null) => void;
  onFocus: (side: -1 | 1, bay: number) => void;
}

/** Единственный холст сайта: интро, зал и перелёт книги идут в нём без склеек. */
export function WorldCanvas(props: WorldProps) {
  const quality = useWorld((s) => s.quality);
  const stage = useWorld((s) => s.stage);
  const [dpr, setDpr] = useState(Math.min(window.devicePixelRatio, quality.maxDpr));
  // Монитор не может уронить картинку ниже этой границы: мыло хуже нескольких потерянных кадров.
  const minDpr = quality.level === 'low' ? 0.6 : 0.8;

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio, quality.maxDpr));
  }, [quality]);

  // За читалкой сцена неподвижна: кадры рисуются только по запросу, и GPU отдыхает.
  const idle = stage === 'reading' || stage === 'backdrop';
  const className = `world-canvas ${stage === 'reading' ? 'is-dimmed' : ''} ${stage === 'backdrop' ? 'is-soft' : ''}`;

  return (
    <div className={className} aria-hidden="true">
      <Canvas
        dpr={dpr}
        frameloop={idle ? 'demand' : 'always'}
        camera={{ fov: 34, near: 0.05, far: 90, position: [0, 0, 9] }}
        gl={{ antialias: quality.level !== 'low', powerPreference: 'high-performance', stencil: false, depth: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
        }}
      >
        {/* Смена разрешения пересоздаёт буферы кадра, поэтому качество подбирается только в спокойном зале */}
        {stage === 'library' && (
          <PerformanceMonitor
            flipflops={3}
            onDecline={() => setDpr((value) => Math.max(minDpr, value - 0.1))}
            onIncline={() => setDpr((value) => Math.min(quality.maxDpr, Math.min(window.devicePixelRatio, value + 0.1)))}
          />
        )}
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
