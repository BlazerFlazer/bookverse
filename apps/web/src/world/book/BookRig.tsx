import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  Vector2,
  type Texture,
} from 'three';
import type { CoverTextures } from '../textures/cover.ts';
import { rt } from '../runtime.ts';
import { BOARD, BOOK_H, BOOK_W, coverBoardGeometry, createSpineGeometry, createStackGeometry, easeInOut, lerp, smoothstep, updateSpineGeometry, updateStackGeometry } from './geometry.ts';
import { PageFan, type FanUniforms } from './PageFan.tsx';

const PULSE_HEAD = /* glsl */ `
  uniform float uPulse;
  uniform float uGlow;
`;
const PULSE_BODY = /* glsl */ `
  #include <emissivemap_fragment>
  // Волна расходится от центра обложки и на мгновение усиливает золото.
  float pulseDist = distance(vEmissiveMapUv, vec2(0.5));
  float pulseWave = smoothstep(0.16, 0.0, abs(pulseDist - uPulse * 0.95)) * step(0.001, uPulse) * (1.0 - uPulse);
  totalEmissiveRadiance *= uGlow + pulseWave * 2.4;
`;

interface BookRigProps {
  textures: CoverTextures;
  leatherColor: string;
  paper: Texture;
  edge: Texture;
  glow: Texture;
  fanCount: number;
}

/**
 * Книга как шарнирный механизм. Задняя доска неподвижна, корешок вращается вокруг её края,
 * передняя доска вокруг края корешка, а страницы лежат на досках и меняют профиль.
 * Позу задают значения rt.hero, которые двигает GSAP.
 */
export function BookRig({ textures, leatherColor, paper, edge, glow, fanCount }: BookRigProps) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const hinge = useRef<Group>(null);
  const backCover = useRef<Mesh>(null);
  const rightStack = useRef<Mesh>(null);
  const leftStack = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  const halo = useRef<Sprite>(null);
  const fan = useRef<FanUniforms | null>(null);

  const board = useMemo(() => coverBoardGeometry(), []);
  const spine = useMemo(() => createSpineGeometry(), []);
  const right = useMemo(() => createStackGeometry(false), []);
  const left = useMemo(() => createStackGeometry(true), []);

  const pulse = useRef({ uPulse: { value: 0 }, uGlow: { value: 0 } });

  const front = useMemo(() => {
    const m = new MeshStandardMaterial({
      map: textures.map,
      normalMap: textures.normalMap,
      roughnessMap: textures.ormMap,
      metalnessMap: textures.ormMap,
      emissiveMap: textures.emissiveMap,
      emissive: new Color('#ffffff'),
      metalness: 1,
      roughness: 1,
      normalScale: new Vector2(0.62, 0.62),
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, pulse.current);
      shader.fragmentShader = PULSE_HEAD + shader.fragmentShader.replace('#include <emissivemap_fragment>', PULSE_BODY);
    };
    m.customProgramCacheKey = () => 'book-front';
    return m;
    // Материалы создаются один раз: смена книги меняет только текстуры в эффекте ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coverSide = useMemo(() => new MeshStandardMaterial({ color: leatherColor, roughness: 0.55 }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const back = useMemo(() => new MeshStandardMaterial({ color: leatherColor, roughness: 0.6 }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spineMaterial = useMemo(() => new MeshStandardMaterial({ map: textures.spine, roughness: 0.5, metalness: 0.15, side: DoubleSide }), []);
  const paperMaterial = useMemo(() => new MeshStandardMaterial({ map: paper, roughness: 0.86 }), [paper]);
  const edgeMaterial = useMemo(() => new MeshStandardMaterial({ map: edge, roughness: 0.78, color: '#f4e4c1' }), [edge]);
  const endpaper = useMemo(() => new MeshStandardMaterial({ color: '#3b1c1f', roughness: 0.8, side: DoubleSide }), []);

  useEffect(() => () => {
    board.dispose();
    spine.dispose();
    right.dispose();
    left.dispose();
  }, [board, spine, right, left]);

  // Новая книга получает ту же геометрию и те же материалы: пересоздавать их дорого
  // и незачем, а замена текстуры одного типа не требует пересборки шейдера.
  useLayoutEffect(() => {
    front.map = textures.map;
    front.normalMap = textures.normalMap;
    front.roughnessMap = textures.ormMap;
    front.metalnessMap = textures.ormMap;
    front.emissiveMap = textures.emissiveMap;
    spineMaterial.map = textures.spine;
    coverSide.color.set(leatherColor);
    back.color.set(leatherColor);
  }, [textures, leatherColor, front, spineMaterial, coverSide, back]);

  useEffect(() => () => {
    front.dispose();
    coverSide.dispose();
    back.dispose();
    spineMaterial.dispose();
  }, [front, coverSide, back, spineMaterial]);

  const last = useRef({ open: -1, fan: -1, thickness: -1, ratio: -1 });

  useFrame(() => {
    const hero = rt.hero;
    const group = root.current;
    if (light.current) {
      light.current.position.set(hero.pos.x, hero.pos.y + 0.3 * hero.scale, hero.pos.z + 0.8 * hero.scale);
      light.current.intensity = hero.visible ? hero.innerLight * 2.6 : 0;
    }
    if (!group || !body.current || !hinge.current) return;
    group.visible = hero.visible;
    if (!hero.visible) return;

    group.position.copy(hero.pos);
    group.rotation.set(hero.rot.x, hero.rot.y, hero.rot.z);
    group.scale.setScalar(hero.scale);

    pulse.current.uPulse.value = hero.pulse;
    pulse.current.uGlow.value = hero.glow;

    const inner = hero.innerLight;
    if (halo.current) {
      halo.current.visible = inner > 0.01;
      // Свет выходит из щели корешка: пятно узкое и вытянуто вдоль него.
      halo.current.scale.set(BOOK_W * (0.5 + inner * 1.1), BOOK_H * (1.05 + inner * 0.9), 1);
      (halo.current.material as SpriteMaterial).opacity = Math.min(0.85, inner * 0.62);
    }

    const state = last.current;
    if (state.open === hero.open && state.fan === hero.fan && state.thickness === hero.thickness && state.ratio === hero.openRatio) return;
    state.open = hero.open;
    state.fan = hero.fan;
    state.thickness = hero.thickness;
    state.ratio = hero.openRatio;

    const T = hero.thickness;
    const o = hero.open;
    const eased = easeInOut(o);
    const phi = (Math.PI / 2) * smoothstep(0, 0.9, o);
    const theta = Math.PI * eased;

    const hingeX = -T * Math.sin(phi);
    const hingeZ = -T / 2 + T * Math.cos(phi);
    hinge.current.position.set(hingeX, 0, hingeZ);
    hinge.current.rotation.y = -theta;

    // Точка опоры уходит с центра закрытой книги на середину разворота.
    body.current.position.x = lerp(-BOOK_W / 2, T / 2, eased);

    if (backCover.current) backCover.current.position.z = -T / 2 - BOARD;

    const pageBlock = T * 0.94;
    const leftShare = pageBlock * hero.openRatio * smoothstep(0.05, 1, hero.fan);
    const rightHeight = pageBlock - leftShare;
    const gutter = (T / 2) * eased;
    const arch = smoothstep(0.15, 0.95, o);

    if (rightStack.current) rightStack.current.position.z = -T / 2;
    updateStackGeometry(right, { height: rightHeight, inner: gutter, arch, slant: 0.26 * arch });
    updateStackGeometry(left, { height: Math.max(leftShare, 0.0001), inner: gutter, arch, slant: 0.26 * arch });
    if (leftStack.current) leftStack.current.visible = o > 0.02;

    const dirX = -Math.sin(phi);
    const dirZ = Math.cos(phi);
    updateSpineGeometry(
      spine,
      { x: dirX * -BOARD, z: -T / 2 + dirZ * -BOARD },
      { x: hingeX + dirX * BOARD, z: hingeZ + dirZ * BOARD },
      T * 0.16 * (1 - 0.82 * eased),
    );

    if (fan.current) {
      fan.current.uFan.value = hero.fan;
      fan.current.uGutter.value = -T / 2 * eased;
      fan.current.uRightZ.value = -T / 2 + rightHeight + 0.002;
      fan.current.uLeftZ.value = -T / 2 + leftShare + 0.004;
    }
  });

  return (
    <>
    <pointLight ref={light} color="#ffc877" intensity={0} distance={7} decay={1.6} />
    <group ref={root} visible={false}>
      <group ref={body}>
        <mesh ref={backCover} geometry={board} material={[back, coverSide]} castShadow />
        <mesh ref={rightStack} geometry={right} material={[paperMaterial, edgeMaterial]} frustumCulled={false} />
        <mesh geometry={spine} material={spineMaterial} frustumCulled={false} />

        <group ref={hinge}>
          <mesh geometry={board} material={[front, coverSide]} castShadow />
          <mesh position={[BOOK_W / 2 + 0.002, 0, -0.0006]} material={endpaper}>
            <planeGeometry args={[BOOK_W - 0.012, BOOK_H - 0.012]} />
          </mesh>
          {/* Стопка лежит на внутренней стороне доски: поворот на 180° переносит её в глубину книги */}
          <group rotation={[Math.PI, 0, 0]}>
            <mesh ref={leftStack} geometry={left} material={[paperMaterial, edgeMaterial]} frustumCulled={false} />
          </group>
        </group>

        <PageFan count={fanCount} paper={paper} uniformsRef={fan} />

        <sprite ref={halo} position={[0, 0, 0.12]} visible={false}>
          <spriteMaterial map={glow} color="#ffd9a0" transparent blending={AdditiveBlending} depthWrite={false} depthTest={false} />
        </sprite>
      </group>
    </group>
    </>
  );
}
