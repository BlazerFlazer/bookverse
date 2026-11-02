import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshStandardMaterial, Object3D, Sprite, SpriteMaterial } from 'three';
import { withAtmosphere } from '../../atmosphere/lighting.ts';
import { assets } from '../assets.ts';
import { rt } from '../runtime.ts';
import { archFrameGeometry, archGlassGeometry, archWallGeometry, curtainGeometry } from './build.ts';
import { ALCOVE, bayCenterZ, FAR_WINDOW, HALL, hallEndZ, SIDE_WINDOW, WINDOW_BAYS } from './layout.ts';
import { glassMaterial, syncGlass } from './rainGlass.ts';

const dummy = new Object3D();
const halo = new Color();

function FarWindow() {
  const { width, height, sill } = FAR_WINDOW;
  const glass = useMemo(() => archGlassGeometry(width, height), [width, height]);
  const frame = useMemo(() => archFrameGeometry(width, height, 0.42, 0.7), [width, height]);
  const material = useMemo(
    () => glassMaterial({ size: [width, height], exterior: assets.exterior, dropScale: 0.34, viewScale: 0.075, barWidth: 0.07, barCell: [1.75, 2.1], seed: 2.3 }),
    [width, height],
  );
  const stone = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#4a3324', roughness: 0.7 }), 'far-frame'), []);
  const glow = useRef<Sprite>(null);

  useFrame(() => {
    const sprite = glow.current;
    if (!sprite) return;
    const spriteMaterial = sprite.material as SpriteMaterial;
    const { frame: light, flash } = rt.atmos;
    spriteMaterial.color.copy(halo.copy(light.skyLow));
    spriteMaterial.opacity = rt.library.reveal * (0.1 + light.daylight * 0.36 + flash * 0.3);
  });

  return (
    <group position={[0, sill, hallEndZ - 0.4]}>
      <mesh geometry={glass} material={material} />
      <mesh geometry={frame} material={stone} position={[0, 0, 0.72]} />
      <mesh position={[0, 6.5, -0.3]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial color="#0c0908" />
      </mesh>
      <sprite ref={glow} position={[0, 6.5, 0.8]} scale={[24, 24, 1]}>
        <spriteMaterial map={assets.glow} transparent blending={AdditiveBlending} depthWrite={false} opacity={0} />
      </sprite>
    </group>
  );
}

function SideWindows({ count }: { count: number }) {
  const { width, height, sill, x } = SIDE_WINDOW;
  const glassMesh = useRef<InstancedMesh>(null);
  const frameMesh = useRef<InstancedMesh>(null);
  const wallMesh = useRef<InstancedMesh>(null);
  const glass = useMemo(() => archGlassGeometry(width, height), [width, height]);
  const frame = useMemo(() => archFrameGeometry(width, height, 0.17, 0.3).translate(0, 0, 0.32), [width, height]);
  const wall = useMemo(() => archWallGeometry(HALL.bay, HALL.deckY - sill, HALL.springY + 0.3 - sill, width, height), [width, height, sill]);
  const material = useMemo(
    () => glassMaterial({ size: [width, height], exterior: assets.exterior, dropScale: 1.1, viewScale: 0.13, barWidth: 0.035, barCell: [0.625, 0.8], seed: 5.1 }),
    [width, height],
  );
  const wood = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#5a3b26', roughness: 0.55 }), 'side-frame'), []);
  const panel = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#2e1e14', roughness: 0.74 }), 'side-wall'), []);

  const bays = useMemo(() => WINDOW_BAYS.slice(0, count), [count]);
  useLayoutEffect(() => {
    let index = 0;
    for (const side of [-1, 1]) {
      for (const bay of bays) {
        dummy.position.set(side * x, sill, bayCenterZ(bay));
        dummy.rotation.set(0, -side * (Math.PI / 2), 0);
        dummy.updateMatrix();
        for (const mesh of [glassMesh, frameMesh, wallMesh]) mesh.current!.setMatrixAt(index, dummy.matrix);
        index += 1;
      }
    }
    for (const mesh of [glassMesh, frameMesh, wallMesh]) mesh.current!.instanceMatrix.needsUpdate = true;
  }, [bays, sill, x]);

  const total = bays.length * 2;
  return (
    <>
      {/* Счёт окон меняет размер буферов, поэтому при смене качества меш создаётся заново */}
      <instancedMesh key={`glass-${total}`} ref={glassMesh} args={[glass, material, total]} frustumCulled={false} />
      <instancedMesh key={`frame-${total}`} ref={frameMesh} args={[frame, wood, total]} frustumCulled={false} />
      <instancedMesh key={`wall-${total}`} ref={wallMesh} args={[wall, panel, total]} frustumCulled={false} />
    </>
  );
}

/** Ниша с большим окном: скамья, подушки и шторы. Сюда камера подходит вплотную. */
function Alcove() {
  const { width, height, sill, x, z } = ALCOVE;
  const glass = useMemo(() => archGlassGeometry(width, height), [width, height]);
  const frame = useMemo(() => archFrameGeometry(width, height, 0.26, 0.42), [width, height]);
  const curtain = useMemo(() => curtainGeometry(0.72, 4.7), []);
  const wall = useMemo(() => archWallGeometry(HALL.bay, -sill, HALL.deckY + 0.1 - sill, width, height), [width, height, sill]);
  const material = useMemo(
    () => glassMaterial({ size: [width, height], exterior: assets.exterior, dropScale: 2.7, viewScale: 0.17, barWidth: 0.022, barCell: [0.715, 0.88], seed: 8.7 }),
    [width, height],
  );
  const wood = useMemo(() => withAtmosphere(new MeshStandardMaterial({ map: assets.wood.map, normalMap: assets.wood.normalMap, color: '#8e6442', roughness: 0.46 }), 'alcove-wood'), []);
  const cloth = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#5c1f27', roughness: 0.82, side: DoubleSide }), 'alcove-cloth'), []);
  const cushion = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#2f4a42', roughness: 0.78 }), 'alcove-cushion'), []);
  const panel = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#2a1a11', roughness: 0.8 }), 'alcove-panel'), []);

  return (
    <group position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
      <group position={[0, sill, 0]}>
        <mesh geometry={glass} material={material} />
        <mesh geometry={wall} material={panel} position={[0, 0, 0.02]} />
        <mesh geometry={frame} material={wood} position={[0, 0, 0.44]} />
      </group>
      {/* Подоконник-скамья */}
      <mesh position={[0, 0.25, 0.42]} material={wood}>
        <boxGeometry args={[width + 0.2, 0.5, 0.84]} />
      </mesh>
      <mesh position={[0, 0.56, 0.42]} material={cushion}>
        <boxGeometry args={[width - 0.1, 0.12, 0.72]} />
      </mesh>
      <mesh position={[-0.9, 0.76, 0.26]} rotation={[0.3, 0.2, 0.05]} material={cloth}>
        <boxGeometry args={[0.5, 0.34, 0.13]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={curtain} material={cloth} position={[side * (width / 2 + 0.02), 2.56, 0.74]} />
      ))}
      <mesh position={[0, 4.92, 0.76]} rotation={[0, 0, Math.PI / 2]} material={wood}>
        <cylinderGeometry args={[0.028, 0.028, width + 0.9, 8]} />
      </mesh>
    </group>
  );
}

export function RainWindows({ sideWindows }: { sideWindows: number }) {
  useFrame(() => syncGlass());
  return (
    <>
      <FarWindow />
      <SideWindows count={sideWindows} />
      <Alcove />
    </>
  );
}
