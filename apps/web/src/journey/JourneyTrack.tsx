import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  BoxGeometry,
} from 'three';
import type { ChapterSummaryDto } from '@bookverse/shared';
import { mulberry } from '../world/textures/noise.ts';
import { BIOMES } from './biomes.ts';

/** Длина дорожки в единицах сцены. Вся карта приключения строится вдоль оси X. */
const TRACK = 100;
const START_X = 2;
const FINISH_X = 95;


function heightAt(x: number): number {
  if (x > 41 && x < 50) return 0.26;
  return 0.16 * Math.sin(x * 0.13) + 0.1 * Math.sin(x * 0.37) + (x > 50 && x < 76 ? Math.sin(((x - 50) / 26) * Math.PI) * 0.75 : 0);
}

function Ground() {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(TRACK + 40, 18, 150, 10);
    g.rotateX(-Math.PI / 2);
    g.translate(TRACK / 2, 0, -4);
    const position = g.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    const color = new Color();
    const path = new Color('#c7ab7a');
    const water = new Color('#4d8fb0');
    const rand = mulberry(8);
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const onPath = Math.abs(z) < 0.6;
      const river = x > 41 && x < 50;
      const biome = BIOMES.find((b) => x <= b.until) ?? BIOMES.at(-1)!;
      color.set(biome.color).offsetHSL(0, 0, (rand() - 0.5) * 0.05);
      if (river) color.copy(water).offsetHSL(0, 0, (rand() - 0.5) * 0.04);
      if (onPath && !river) color.lerp(path, 0.9);
      position.setY(i, river ? -0.25 : heightAt(x) - (onPath ? 0.02 : 0) + (Math.abs(z) > 2 ? (rand() - 0.5) * 0.18 : 0) + (z < -6 ? (-z - 6) * 0.14 : 0));
      colors.set([color.r, color.g, color.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial vertexColors flatShading />
    </mesh>
  );
}

const dummy = new Object3D();

function Forest() {
  const crowns = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const trees = useMemo(() => {
    const rand = mulberry(31);
    const list: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 150; i += 1) {
      const x = rand() * (TRACK + 10);
      const dense = x > 16 && x < 41;
      if (!dense && rand() > 0.28) continue;
      if ((x > 41 && x < 50) || x > 80) continue;
      // Только за тропой: передние деревья заслоняли бы бегуна.
      const z = -1.5 - rand() * 7;
      list.push({ x, z, s: 0.8 + rand() * 0.9 });
    }
    return list;
  }, []);

  useLayoutEffect(() => {
    trees.forEach((tree, index) => {
      const y = heightAt(tree.x);
      dummy.position.set(tree.x, y + 1.05 * tree.s, tree.z);
      dummy.scale.setScalar(tree.s);
      dummy.rotation.set(0, tree.x, 0);
      dummy.updateMatrix();
      crowns.current!.setMatrixAt(index, dummy.matrix);
      dummy.position.y = y + 0.22 * tree.s;
      dummy.updateMatrix();
      trunks.current!.setMatrixAt(index, dummy.matrix);
    });
    crowns.current!.instanceMatrix.needsUpdate = true;
    trunks.current!.instanceMatrix.needsUpdate = true;
  }, [trees]);

  const crown = useMemo(() => new ConeGeometry(0.62, 1.7, 6), []);
  const trunk = useMemo(() => new CylinderGeometry(0.08, 0.12, 0.5, 5), []);
  return (
    <>
      <instancedMesh ref={crowns} args={[crown, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color="#2f5a3a" flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[trunk, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color="#5b3a25" />
      </instancedMesh>
    </>
  );
}

function Village() {
  const houses = [
    [3.5, -2.4, 1], [7, -3, 1.2], [10.5, -2.2, 0.9], [13.5, -3.4, 1.1],
  ] as const;
  return (
    <>
      {houses.map(([x, z, s], i) => (
        <group key={i} position={[x, heightAt(x), z]} scale={s}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.4, 1, 1.1]} />
            <meshLambertMaterial color="#e6d7b5" />
          </mesh>
          <mesh position={[0, 1.32, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[1.15, 0.72, 4]} />
            <meshLambertMaterial color="#8e3f39" flatShading />
          </mesh>
          <mesh position={[0.3, 0.42, 0.56]}>
            <planeGeometry args={[0.26, 0.3]} />
            <meshBasicMaterial color="#ffd27f" />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Bridge() {
  const planks = Array.from({ length: 22 }, (_, i) => 41 + i * 0.44);
  return (
    <group position={[0, 0.25, 0]}>
      {planks.map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.36, 0.07, 1.3]} />
          <meshLambertMaterial color="#7a5433" />
        </mesh>
      ))}
      {[-0.66, 0.66].map((z) => (
        <mesh key={z} position={[45.5, 0.42, z]}>
          <boxGeometry args={[9.4, 0.05, 0.05]} />
          <meshLambertMaterial color="#5b3a25" />
        </mesh>
      ))}
    </group>
  );
}

function Mountains() {
  const peaks = [
    [50, -10, 5, 7], [57, -12, 7, 10], [64, -9, 5.5, 8], [71, -13, 8, 11], [78, -10, 5, 6.5], [46, -13, 6, 7],
  ] as const;
  return (
    <>
      {peaks.map(([x, z, r, h], i) => (
        <group key={i} position={[x, h / 2 - 0.2, z]}>
          <mesh>
            <coneGeometry args={[r, h, 7]} />
            <meshLambertMaterial color="#6f6a6c" flatShading />
          </mesh>
          <mesh position={[0, h * 0.34, 0]}>
            <coneGeometry args={[r * 0.33, h * 0.33, 7]} />
            <meshLambertMaterial color="#f1ece2" flatShading />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Castle() {
  const towers = [[80, -4], [84, -5], [88, -4], [91, -5.5]] as const;
  return (
    <group position={[0, 0.2, 0]}>
      <mesh position={[85.5, 1.2, -4.6]}>
        <boxGeometry args={[11, 2.4, 1.2]} />
        <meshLambertMaterial color="#a39a8c" />
      </mesh>
      {towers.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.8, 0]}>
            <cylinderGeometry args={[0.72, 0.8, 3.6, 8]} />
            <meshLambertMaterial color="#b2a897" flatShading />
          </mesh>
          <mesh position={[0, 4.2, 0]}>
            <coneGeometry args={[0.96, 1.3, 8]} />
            <meshLambertMaterial color="#682f3c" flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Gate({ finished }: { finished: boolean }) {
  const glow = useRef<MeshLambertMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = finished ? 1.6 + Math.sin(clock.elapsedTime * 3) * 0.5 : 0.2;
  });
  return (
    <group position={[FINISH_X + 1.4, heightAt(FINISH_X), 0]}>
      {[-1.3, 1.3].map((z) => (
        <mesh key={z} position={[0, 1.1, z]}>
          <boxGeometry args={[0.3, 2.2, 0.3]} />
          <meshLambertMaterial color="#8d6a3a" />
        </mesh>
      ))}
      <mesh position={[0, 2.2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.3, 0.17, 8, 18, Math.PI]} />
        <meshLambertMaterial ref={glow} color="#d2a35d" emissive="#ffc766" emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

function Milestones({ chapters, totalChars, completed }: { chapters: ChapterSummaryDto[]; totalChars: number; completed: number[] }) {
  return (
    <>
      {chapters.map((chapter) => {
        const x = START_X + ((chapter.charStart + chapter.charLength) / Math.max(1, totalChars)) * (FINISH_X - START_X);
        const done = completed.includes(chapter.order);
        return (
          <group key={chapter.order} position={[x, heightAt(x), -0.86]}>
            <mesh position={[0, 0.55, 0]}>
              <cylinderGeometry args={[0.025, 0.025, 1.1, 5]} />
              <meshLambertMaterial color="#3a2a1c" />
            </mesh>
            <mesh position={[0.2, 0.92, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.17, 0.4, 3]} />
              <meshLambertMaterial color={done ? '#e6b45e' : '#8f8778'} emissive={done ? '#c98a2f' : '#000000'} emissiveIntensity={0.6} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** Бегун: простая кукла, у которой руки и ноги качаются на шарнирах. */
function Runner({ target, finished }: { target: number; finished: boolean }) {
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const motion = useRef({ x: START_X, phase: 0, speed: 0 });
  const { camera, invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [target, invalidate]);

  useFrame((state, delta) => {
    const m = motion.current;
    const distance = target - m.x;
    const moving = Math.abs(distance) > 0.02;
    const desired = moving ? Math.sign(distance) * Math.min(13, Math.abs(distance) * 3 + 2.5) : 0;
    m.speed += (desired - m.speed) * Math.min(1, delta * 8);
    m.x += m.speed * delta;
    m.phase += Math.abs(m.speed) * delta * 2.1;

    const running = Math.abs(m.speed) > 0.05;
    const t = state.clock.elapsedTime;
    const swing = running ? Math.sin(m.phase) * 1 : Math.sin(t * 1.6) * 0.04;
    if (group.current) {
      group.current.position.set(m.x, heightAt(m.x) + (running ? Math.abs(Math.sin(m.phase)) * 0.09 : 0), 0);
      group.current.rotation.y = m.speed < -0.05 ? Math.PI : 0;
    }
    if (body.current) {
      body.current.rotation.z = running ? -0.2 : 0;
      body.current.position.y = running ? 0 : Math.sin(t * 2) * 0.012;
    }
    if (legL.current) legL.current.rotation.z = swing;
    if (legR.current) legR.current.rotation.z = -swing;
    if (armL.current) armL.current.rotation.z = finished && !running ? Math.PI - 0.3 + Math.sin(t * 8) * 0.25 : -swing * 0.9;
    if (armR.current) armR.current.rotation.z = finished && !running ? Math.PI + 0.3 - Math.sin(t * 8) * 0.25 : swing * 0.9;

    camera.position.set(m.x + 3.4, 2.5, 13);
    camera.lookAt(m.x + 3.4, 1.05, 0);

    // Пока бегун двигается, кадры идут подряд. В покое хватает редких кадров дыхания.
    if (running || moving) invalidate();
  });

  const limb = useMemo(() => new BoxGeometry(0.11, 0.42, 0.13).translate(0, -0.21, 0), []);

  return (
    <group ref={group} scale={0.8}>
      <group ref={body}>
        <group ref={legL} position={[0, 0.5, 0.08]}>
          <mesh geometry={limb}><meshLambertMaterial color="#2b2f45" /></mesh>
        </group>
        <group ref={legR} position={[0, 0.5, -0.08]}>
          <mesh geometry={limb}><meshLambertMaterial color="#1f2233" /></mesh>
        </group>
        <mesh position={[0, 0.78, 0]}>
          <cylinderGeometry args={[0.13, 0.19, 0.56, 8]} />
          <meshLambertMaterial color="#8a3a44" flatShading />
        </mesh>
        <mesh position={[0, 1.16, 0]}>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshLambertMaterial color="#f0cfa8" />
        </mesh>
        <mesh position={[0, 1.33, 0]} rotation={[0, 0, 0.12]}>
          <coneGeometry args={[0.2, 0.26, 8]} />
          <meshLambertMaterial color="#d2a35d" flatShading />
        </mesh>
        <mesh position={[-0.2, 0.84, 0]} rotation={[0, 0, 0.5]}>
          <boxGeometry args={[0.08, 0.5, 0.26]} />
          <meshLambertMaterial color="#5a2230" />
        </mesh>
        <group ref={armL} position={[0, 1, 0.19]}>
          <mesh geometry={limb} scale={[0.75, 0.86, 0.75]}><meshLambertMaterial color="#8a3a44" /></mesh>
        </group>
        <group ref={armR} position={[0, 1, -0.19]}>
          <mesh geometry={limb} scale={[0.75, 0.86, 0.75]}><meshLambertMaterial color="#6f2d38" /></mesh>
        </group>
      </group>
    </group>
  );
}

function IdleTicker() {
  const { invalidate } = useThree();
  useEffect(() => {
    const timer = setInterval(invalidate, 110);
    return () => clearInterval(timer);
  }, [invalidate]);
  return null;
}

export function JourneyTrack({
  percent,
  chapters,
  totalChars,
  completed,
  finished,
}: {
  percent: number;
  chapters: ChapterSummaryDto[];
  totalChars: number;
  completed: number[];
  finished: boolean;
}) {
  const target = START_X + (Math.min(100, percent) / 100) * (FINISH_X - START_X);
  return (
    <Canvas
      className="journey-canvas"
      dpr={[1, 1.5]}
      frameloop="demand"
      camera={{ fov: 15, near: 0.5, far: 70, position: [5, 2.5, 13] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
    >
      <hemisphereLight args={['#fff3dc', '#5b6a55', 1.5]} />
      <directionalLight position={[-3, 6, 4]} intensity={2} color="#ffe0b0" />
      <IdleTicker />
      <Ground />
      <Forest />
      <Village />
      <Bridge />
      <Mountains />
      <Castle />
      <Gate finished={finished} />
      <Milestones chapters={chapters} totalChars={totalChars} completed={completed} />
      <Runner target={target} finished={finished} />
    </Canvas>
  );
}
