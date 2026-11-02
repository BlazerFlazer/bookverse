import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { withAtmosphere } from '../../atmosphere/lighting.ts';
import { assets } from '../assets.ts';
import { GoldDust } from '../fx/Effects.tsx';
import { rt } from '../runtime.ts';
import { archGeometry, balusterGeometry, buildBooks, buildStructure, columnGeometry, hallLength, ladderGeometry, lampBaseGeometry, lampShadeGeometry, tableGeometry, type BoxInstance } from './build.ts';
import { Fireplace } from './Fireplace.tsx';
import { ALCOVE, bakedColor, bayCenterZ, bayLineZ, FIREPLACE, HALL, hallEndZ, PENDANTS, TABLE, TABLE_LAMPS, WINDOW_BAYS } from './layout.ts';
import { RainWindows } from './RainWindows.tsx';

const dummy = new Object3D();

/** Заполняет InstancedMesh коробками с запечённым цветом. */
function useBoxes(mesh: React.RefObject<InstancedMesh | null>, items: BoxInstance[]) {
  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const color = new Color();
    items.forEach((item, index) => {
      dummy.position.set(...item.position);
      dummy.scale.set(...item.size);
      dummy.rotation.set(0, 0, item.lean ?? 0);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
      instanced.setColorAt(index, bakedColor(item.tone, item.position[0], item.position[1], item.position[2], color));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [mesh, items]);
}

/** Золотые бинты и ярлыки на корешках: рисуются процедурно, без текстур. */
function bookMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSpineUv;\nvarying float vSeed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSpineUv = uv;\nvSeed = fract(float(gl_InstanceID) * 0.61803);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSpineUv;\nvarying float vSeed;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float bandA = step(abs(vSpineUv.y - (0.82 + vSeed * 0.08)), 0.012);
        float bandB = step(abs(vSpineUv.y - (0.16 + vSeed * 0.06)), 0.012);
        float label = step(abs(vSpineUv.y - 0.62), 0.06 + vSeed * 0.05) * step(0.55, fract(vSeed * 7.0));
        float gilt = clamp(bandA + bandB + label * 0.65, 0.0, 1.0);
        float lum = dot(vColor.rgb, vec3(0.5, 0.4, 0.2)) * 2.0 + 0.2;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.64, 0.34) * lum, gilt);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.34, gilt);',
      );
  };
  return withAtmosphere(material, 'library-books');
}

function rowMaterial(map: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.66 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      /* glsl */ `#include <uv_vertex>
      float rowLength = length(instanceMatrix[0].xyz);
      vMapUv.x = vMapUv.x * rowLength * 0.5 + fract(float(gl_InstanceID) * 0.37);`,
    );
  };
  return withAtmosphere(material, 'library-rows');
}

function beamMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uColor: { value: rt.atmos.frame.beamColor } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        float along = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.25, vUv.y);
        float drift = 0.72 + 0.28 * sin(vUv.x * 21.0 + uTime * 0.16) * sin(vUv.x * 7.0 - uTime * 0.11);
        gl_FragColor = vec4(uColor, edge * along * drift * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

function Instanced({ items, material, castRef }: { items: BoxInstance[]; material: MeshStandardMaterial; castRef?: React.RefObject<InstancedMesh | null> }) {
  const own = useRef<InstancedMesh>(null);
  const mesh = castRef ?? own;
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useBoxes(mesh, items);
  return <instancedMesh ref={mesh} args={[geometry, material, items.length]} />;
}

function Rows({ material, items }: { material: MeshStandardMaterial; items: ReturnType<typeof buildStructure>['rows'] }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const color = new Color();
    items.forEach((item, index) => {
      dummy.position.set(...item.position);
      dummy.rotation.set(0, item.rotationY, 0);
      dummy.scale.set(item.length, item.height, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
      instanced.setColorAt(index, bakedColor('#ffffff', item.position[0], item.position[1], item.position[2], color));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={mesh} args={[geometry, material, items.length]} />;
}

function Columns() {
  const lower = useRef<InstancedMesh>(null);
  const balusters = useRef<InstancedMesh>(null);
  const column = useMemo(columnGeometry, []);
  const baluster = useMemo(balusterGeometry, []);
  const stone = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#8e6a48', roughness: 0.46, metalness: 0.08 }), 'library-columns'), []);

  const balusterCount = useMemo(() => Math.floor((HALL.bay * HALL.bays) / 0.34) * 2, []);
  const columnCount = (HALL.bays + 1) * 4;

  useLayoutEffect(() => {
    const m = new Matrix4();
    const color = new Color();
    let index = 0;
    for (const side of [-1, 1]) {
      for (let k = 0; k <= HALL.bays; k += 1) {
        const z = bayLineZ(k);
        for (const [y, height] of [[0, 5.02], [HALL.deckY + 0.1, HALL.springY - HALL.deckY - 0.1]] as const) {
          dummy.position.set(side * (HALL.aisle - 0.12), y, z);
          dummy.scale.set(1.15, height, 1.15);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          lower.current!.setMatrixAt(index, dummy.matrix);
          lower.current!.setColorAt(index, bakedColor('#ffffff', dummy.position.x, y + 2, z, color));
          index += 1;
        }
      }
    }
    lower.current!.instanceMatrix.needsUpdate = true;
    lower.current!.computeBoundingSphere();

    index = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < balusterCount / 2; i += 1) {
        const z = HALL.startZ - 0.17 - i * 0.34;
        m.makeScale(1, 0.84, 1).setPosition(side * (HALL.aisle - 0.08), HALL.deckY + 0.22, z);
        balusters.current!.setMatrixAt(index, m);
        balusters.current!.setColorAt(index, bakedColor('#6a4830', side * HALL.aisle, HALL.deckY + 0.6, z, color));
        index += 1;
      }
    }
    balusters.current!.instanceMatrix.needsUpdate = true;
    balusters.current!.computeBoundingSphere();
  }, [balusterCount]);

  return (
    <>
      <instancedMesh ref={lower} args={[column, stone, columnCount]} />
      <instancedMesh ref={balusters} args={[baluster, stone, balusterCount]} />
    </>
  );
}

function Vault() {
  const planks = useMemo(() => {
    const map = assets.wood.map.clone();
    map.repeat.set(9, 22);
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.needsUpdate = true;
    return withAtmosphere(new MeshStandardMaterial({ map, color: '#7a5639', roughness: 0.72, side: BackSide }), 'library-vault');
  }, []);
  const ribs = useRef<InstancedMesh>(null);
  const rib = useMemo(() => archGeometry(HALL.vaultRadius - 0.04), []);
  const ribMaterial = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#4a2e1c', roughness: 0.6 }), 'library-ribs'), []);
  const count = HALL.bays + 1;
  const middleZ = HALL.startZ - (HALL.bay * HALL.bays) / 2;

  useLayoutEffect(() => {
    const color = new Color();
    for (let k = 0; k < count; k += 1) {
      dummy.position.set(0, HALL.springY, bayLineZ(k));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ribs.current!.setMatrixAt(k, dummy.matrix);
      ribs.current!.setColorAt(k, bakedColor('#5a3a26', 0, 11, bayLineZ(k), color));
    }
    ribs.current!.instanceMatrix.needsUpdate = true;
    ribs.current!.computeBoundingSphere();
  }, [count]);

  return (
    <>
      <mesh position={[0, HALL.springY, middleZ]} rotation={[Math.PI / 2, 0, 0]} material={planks}>
        <cylinderGeometry args={[HALL.vaultRadius, HALL.vaultRadius, HALL.bay * HALL.bays + 8, 28, 1, true, -Math.PI / 2, Math.PI]} />
      </mesh>
      <instancedMesh ref={ribs} args={[rib, ribMaterial, count]} />
    </>
  );
}

/** Лучи из дальнего окна и, на сильных устройствах, косые столбы света из окон галереи. */
function Beams({ shafts }: { shafts: boolean }) {
  const material = useMemo(beamMaterial, []);
  const beams = useMemo(
    () => [
      { position: [-1.5, 6.2, hallEndZ + 11] as const, rotation: [0.32, 0.18, 0.1] as const, size: [2.6, 24] as const },
      { position: [1.8, 5.8, hallEndZ + 9] as const, rotation: [0.28, -0.22, -0.08] as const, size: [3.2, 21] as const },
      { position: [0.2, 6.8, hallEndZ + 15] as const, rotation: [0.42, 0.04, 0.03] as const, size: [4.2, 30] as const },
      ...(shafts
        ? WINDOW_BAYS.slice(0, 3).flatMap((bay, index) =>
            [-1, 1].map((side) => ({
              position: [side * 2.4, 5.4, bayCenterZ(bay)] as const,
              rotation: [0.0, side * 0.72, index * 0.04] as const,
              size: [1.9, 8.6] as const,
            })),
          )
        : []),
    ],
    [shafts],
  );
  useFrame((_, delta) => {
    material.uniforms.uTime!.value += delta * rt.atmos.motion;
    material.uniforms.uOpacity!.value = rt.library.reveal * (rt.atmos.frame.beam + rt.atmos.flash * 0.1);
  });
  return (
    <>
      {beams.map((beam, index) => (
        <mesh key={index} position={[...beam.position]} rotation={[Math.PI / 2 + beam.rotation[0], beam.rotation[1], beam.rotation[2]]} material={material} renderOrder={2}>
          <planeGeometry args={[...beam.size]} />
        </mesh>
      ))}
    </>
  );
}

const LIGHT_SPOTS: [number, number, number][] = [
  [0, 5.8, 1.6],
  [0, 1.5, TABLE.centerZ],
  [-3.2, 3.4, bayCenterZ(0)],
  [3.2, 3.4, bayCenterZ(0)],
];

/**
 * Лампы не входят в скрываемую группу зала. Число источников в сцене влияет на шейдеры,
 * и если оно меняется при смене стадии, все материалы пересобираются прямо во время показа.
 */
export function LibraryLights({ count }: { count: number }) {
  const lights = useRef<(PointLight | null)[]>([]);
  useFrame(() => {
    const reveal = rt.library.visible ? rt.library.reveal * rt.library.dim : 0;
    const { frame, motion, rainTime } = rt.atmos;
    lights.current.forEach((light, index) => {
      if (!light) return;
      // Дрожание почти незаметно: лампа живёт, но не мигает.
      const flicker = 1 + motion * Math.sin(rainTime * 3.1 + index * 1.7) * 0.012;
      light.intensity = reveal * (index === 0 ? 30 : 9) * frame.lamp * flicker;
      light.color.copy(frame.lampColor);
    });
  });
  return (
    <>
      {LIGHT_SPOTS.slice(0, count).map((position, index) => (
        <pointLight
          key={index}
          ref={(l) => {
            lights.current[index] = l;
          }}
          position={position}
          color="#ffc98a"
          distance={20}
          decay={1.6}
          intensity={0}
        />
      ))}
    </>
  );
}

function Lamps({ glow }: { glow: Texture }) {
  const halos = useRef<(Sprite | null)[]>([]);
  const shades = useRef<MeshStandardMaterial>(null);
  const base = useMemo(lampBaseGeometry, []);
  const shade = useMemo(lampShadeGeometry, []);
  const brass = useMemo(() => new MeshStandardMaterial({ color: '#b98a45', metalness: 0.9, roughness: 0.35 }), []);

  const lamps = useMemo(
    () => [
      ...PENDANTS.map((p, i) => ({ position: p, size: 5.2, stagger: 0.12 + i * 0.1, color: '#ffbe78' })),
      ...TABLE_LAMPS.map((p, i) => ({ position: [p[0], p[1] - 0.14, p[2]] as [number, number, number], size: 1.5, stagger: i * 0.05, color: '#ffd9a0' })),
    ],
    [],
  );

  useFrame((state) => {
    const reveal = rt.library.reveal * rt.library.dim;
    lamps.forEach((lamp, index) => {
      const sprite = halos.current[index];
      if (!sprite) return;
      // Лампы загораются по очереди от камеры в глубину зала.
      const on = Math.min(1, Math.max(0, (reveal - lamp.stagger) / 0.35));
      const flicker = 1 + rt.atmos.motion * Math.sin(state.clock.elapsedTime * 1.7 + index * 2.1) * 0.025;
      (sprite.material as SpriteMaterial).opacity = on * 0.7 * flicker * (0.46 + rt.atmos.frame.lamp * 0.54);
    });
    if (shades.current) shades.current.emissiveIntensity = reveal * 0.22;
  });

  return (
    <>
      {PENDANTS.map((p, i) => (
        <group key={i} position={p}>
          <mesh>
            <sphereGeometry args={[0.2, 14, 10]} />
            <meshBasicMaterial color="#ffe2b4" fog={false} toneMapped={false} />
          </mesh>
          <mesh position={[0, 3.2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 6.2, 5]} />
            <meshStandardMaterial color="#2a1c12" />
          </mesh>
        </group>
      ))}
      {TABLE_LAMPS.map((p, i) => (
        <group key={i} position={[p[0], TABLE.height + 0.04, p[2]]}>
          <mesh geometry={base} material={brass} />
          <mesh geometry={shade} position={[0, 0.33, 0]}>
            <meshStandardMaterial ref={i === 0 ? shades : undefined} color="#1a5a48" emissive="#3f9b7c" roughness={0.28} metalness={0.2} />
          </mesh>
        </group>
      ))}
      {lamps.map((lamp, index) => (
        <sprite
          key={index}
          ref={(s) => {
            halos.current[index] = s;
          }}
          position={lamp.position}
          scale={[lamp.size, lamp.size, 1]}
        >
          <spriteMaterial map={glow} color={lamp.color} transparent blending={AdditiveBlending} depthWrite={false} opacity={0} fog={false} />
        </sprite>
      ))}
    </>
  );
}

function Props() {
  const wood = useMemo(() => withAtmosphere(new MeshStandardMaterial({ map: assets.wood.map, normalMap: assets.wood.normalMap, color: '#a87c58', roughness: 0.42 }), 'library-props'), []);
  const top = useMemo(tableGeometry, []);
  const ladder = useMemo(() => ladderGeometry(4.7), []);
  const paper = useMemo(() => withAtmosphere(new MeshStandardMaterial({ map: assets.paper, roughness: 0.9 }), 'library-paper'), []);
  const tomes: [number, number, number, string][] = [
    [-0.42, TABLE.height + 0.08, TABLE.centerZ + 1.7, '#6a2d33'],
    [0.46, TABLE.height + 0.08, TABLE.centerZ - 1.4, '#2f4a42'],
    [-0.38, TABLE.height + 0.13, TABLE.centerZ + 1.72, '#7a5426'],
  ];
  return (
    <>
      <mesh geometry={top} material={wood} />
      <mesh geometry={ladder} material={wood} position={[-3.55, 0, bayCenterZ(2) + 0.9]} rotation={[0.14, Math.PI / 2, 0]} />
      <mesh geometry={ladder} material={wood} position={[3.55, 0, bayCenterZ(6) - 0.7]} rotation={[0.14, -Math.PI / 2, 0]} />
      {tomes.map(([x, y, z, color], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, i * 0.5, 0]}>
          <boxGeometry args={[0.28, 0.05, 0.38]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      ))}
      <group position={[0.1, TABLE.height + 0.06, TABLE.centerZ + 0.4]} rotation={[0, 0.12, 0]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.17, 0.02, 0]} rotation={[-Math.PI / 2, side * 0.06, 0]} material={paper}>
            <planeGeometry args={[0.33, 0.45]} />
          </mesh>
        ))}
      </group>
    </>
  );
}

/**
 * Отражения дешёвые: мягкие пятна поверх пола и стола. Настоящие зеркала здесь не нужны,
 * а глаз читает их как полированное дерево, в котором отражаются окна, лампы и огонь.
 */
function FloorPools({ glow }: { glow: Texture }) {
  const warm = useRef<MeshBasicMaterial>(null);
  const far = useRef<MeshBasicMaterial>(null);
  const niche = useRef<MeshBasicMaterial>(null);
  const hearth = useRef<MeshBasicMaterial>(null);
  const table = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const { frame, flash } = rt.atmos;
    const reveal = rt.library.reveal * rt.library.dim;
    const cold = reveal * (frame.daylight * 0.62 + flash * 0.3);
    if (warm.current) warm.current.opacity = reveal * 0.34 * frame.lamp;
    if (table.current) table.current.opacity = reveal * 0.2 * frame.lamp;
    if (hearth.current) hearth.current.opacity = reveal * 0.34 * frame.fire;
    for (const pool of [far.current, niche.current]) {
      if (!pool) continue;
      pool.opacity = cold;
      pool.color.copy(frame.skyLow);
    }
  });

  const pool = (ref: React.RefObject<MeshBasicMaterial | null>, position: [number, number, number], size: [number, number], color: string) => (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial ref={ref} map={glow} color={color} transparent blending={AdditiveBlending} depthWrite={false} opacity={0} />
    </mesh>
  );

  return (
    <>
      {pool(warm, [0, 0.012, -22], [8, 34], '#ff9e4f')}
      {pool(far, [0, 0.014, hallEndZ + 8], [8.5, 20], '#ffffff')}
      {pool(niche, [ALCOVE.x - 2.3, 0.016, ALCOVE.z], [5, 5.4], '#ffffff')}
      {pool(hearth, [FIREPLACE.x + 1.9, 0.018, FIREPLACE.z], [4.4, 4.6], '#ff7a2e')}
      {pool(table, [0, TABLE.height + 0.04, TABLE.centerZ], [1.5, TABLE.length * 0.96], '#ffc98a')}
    </>
  );
}

interface LibraryProps {
  shelfBooks: number;
  dustCount: number;
  sideWindows: number;
  lightShafts: boolean;
  children?: React.ReactNode;
}

export function Library({ shelfBooks, dustCount, sideWindows, lightShafts, children }: LibraryProps) {
  const group = useRef<Group>(null);

  // Ближние пролёты собраны из настоящих коробок, дальние из картинок. Граница зависит от бюджета.
  const books = useMemo(() => buildBooks(shelfBooks), [shelfBooks]);
  const realBays = useMemo(() => {
    let bay = 0;
    const lastZ = books.at(-1)?.position[2] ?? 0;
    while (bay < HALL.bays && bayCenterZ(bay) - HALL.bay / 2 >= lastZ) bay += 1;
    return bay;
  }, [books]);
  const structure = useMemo(() => buildStructure(realBays, sideWindows), [realBays, sideWindows]);

  const woodMaterial = useMemo(() => withAtmosphere(new MeshStandardMaterial({ map: assets.wood.map, normalMap: assets.wood.normalMap, roughness: 0.52, metalness: 0.02 }), 'library-wood'), []);
  const spineMaterial = useMemo(bookMaterial, []);
  const rowsMaterial = useMemo(() => rowMaterial(assets.shelfRow), []);
  const floorMaterial = useMemo(() => {
    const map = assets.floor.clone();
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.repeat.set(5, 26);
    map.needsUpdate = true;
    return withAtmosphere(new MeshStandardMaterial({ map, color: '#c79a72', roughness: 0.42, metalness: 0.08 }), 'library-floor');
  }, []);

  useFrame(() => {
    if (group.current) group.current.visible = rt.library.visible;
  });

  return (
    <group ref={group} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, HALL.startZ + 2 - hallLength / 2]} material={floorMaterial}>
        <planeGeometry args={[14, hallLength + 4]} />
      </mesh>
      <mesh position={[0, 7, HALL.startZ + 4.2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[14, 20]} />
        <meshStandardMaterial color="#1c120c" roughness={0.9} />
      </mesh>

      <Instanced items={structure.boards} material={woodMaterial} />
      {books.length > 0 && <Instanced items={books} material={spineMaterial} />}
      {structure.rows.length > 0 && <Rows material={rowsMaterial} items={structure.rows} />}
      <Columns />
      <Vault />
      <Props />
      <RainWindows sideWindows={sideWindows} />
      <Fireplace />
      <Beams shafts={lightShafts} />
      <FloorPools glow={assets.glow} />
      <Lamps glow={assets.glow} />
      <GoldDust count={dustCount} area={[9, 9, 30]} center={[0, 4.5, -8]} color={rt.atmos.frame.dustColor} strength={() => rt.library.reveal * rt.library.dim * 0.75 * rt.atmos.frame.dust} />
      {children}
    </group>
  );
}
