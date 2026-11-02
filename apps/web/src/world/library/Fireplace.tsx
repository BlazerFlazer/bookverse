import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, Mesh, MeshStandardMaterial, ShaderMaterial, Sprite, SpriteMaterial } from 'three';
import { withAtmosphere } from '../../atmosphere/lighting.ts';
import { assets } from '../assets.ts';
import { rt } from '../runtime.ts';
import { FIREPLACE } from './layout.ts';

const EMBER = new Color('#ff8a3c');

/** Пламя живёт в шейдере: языки из шума на одном прямоугольнике, без частиц. */
function flameMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      varying vec2 vUv;

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        vec2 h = vec2(127.1, 311.7);
        float a = fract(sin(dot(i, h)) * 43758.5);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), h)) * 43758.5);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), h)) * 43758.5);
        float d = fract(sin(dot(i + vec2(1.0, 1.0), h)) * 43758.5);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 uv = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        float rise = uTime * 1.3;
        float n = noise(vec2(uv.x * 3.2, uv.y * 2.4 - rise)) * 0.6 + noise(vec2(uv.x * 7.0, uv.y * 5.0 - rise * 1.8)) * 0.4;
        float span = max(0.0, 1.0 - uv.x * uv.x * 1.2);
        float height = span * (0.34 + uPower * 0.62) + 0.001;
        float body = smoothstep(height, height * 0.2, uv.y + (n - 0.5) * 0.46) * smoothstep(0.0, 0.3, span);
        vec3 color = mix(vec3(0.95, 0.22, 0.03), vec3(1.0, 0.72, 0.22), body * body);
        color = mix(color, vec3(1.0, 0.95, 0.72), pow(body, 5.0));
        gl_FragColor = vec4(color, body * smoothstep(0.0, 0.05, uv.y) * min(1.0, uPower * 1.6));
      }
    `,
  });
}

/** Камин напротив окна. Вечером и ночью он главный источник тепла в этой части зала. */
export function Fireplace() {
  const flames = useMemo(flameMaterial, []);
  const flameMesh = useRef<Mesh>(null);
  const glow = useRef<Sprite>(null);
  const stone = useMemo(() => withAtmosphere(new MeshStandardMaterial({ color: '#574c44', roughness: 0.86 }), 'hearth-stone'), []);
  const soot = useMemo(() => new MeshStandardMaterial({ color: '#0d0a09', roughness: 1 }), []);
  const wood = useMemo(() => withAtmosphere(new MeshStandardMaterial({ map: assets.wood.map, color: '#8a5f3e', roughness: 0.5 }), 'hearth-mantel'), []);
  const log = useMemo(() => new MeshStandardMaterial({ color: '#2b1a10', roughness: 0.95, emissive: EMBER, emissiveIntensity: 0 }), []);

  useFrame((_, delta) => {
    const fire = rt.atmos.frame.fire;
    const visible = rt.library.visible && fire > 0.02;
    if (flameMesh.current) flameMesh.current.visible = visible;
    if (glow.current) {
      glow.current.visible = visible;
      const flicker = 1 + rt.atmos.motion * Math.sin(rt.atmos.rainTime * 11) * 0.06;
      (glow.current.material as SpriteMaterial).opacity = fire * 0.6 * flicker * rt.library.reveal;
    }
    log.emissiveIntensity = fire * 0.7;
    if (!visible) return;
    flames.uniforms.uTime!.value += delta * rt.atmos.motion;
    flames.uniforms.uPower!.value = fire;
  });

  return (
    <group position={[FIREPLACE.x, 0, FIREPLACE.z]} rotation={[0, Math.PI / 2, 0]}>
      {/* Топка и каменный портал */}
      <mesh position={[0, 0.72, -0.02]} material={soot}>
        <boxGeometry args={[1.5, 1.34, 0.08]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.96, 0.72, 0.16]} material={stone}>
          <boxGeometry args={[0.42, 1.44, 0.44]} />
        </mesh>
      ))}
      <mesh position={[0, 1.5, 0.16]} material={stone}>
        <boxGeometry args={[2.4, 0.3, 0.46]} />
      </mesh>
      <mesh position={[0, 1.68, 0.2]} material={wood}>
        <boxGeometry args={[2.72, 0.08, 0.62]} />
      </mesh>
      <mesh position={[0, 0.04, 0.46]} material={stone}>
        <boxGeometry args={[2.8, 0.08, 1.04]} />
      </mesh>
      {/* Поленья */}
      {[[-0.28, 0.13, 0.2, 0.2], [0.26, 0.13, 0.26, -0.26], [0, 0.26, 0.2, 0.05]].map(([x, y, z, turn], i) => (
        <mesh key={i} position={[x!, y!, z!]} rotation={[0, turn!, Math.PI / 2]} material={log}>
          <cylinderGeometry args={[0.075, 0.09, 0.84, 7]} />
        </mesh>
      ))}
      <mesh ref={flameMesh} position={[0, 0.66, 0.24]} material={flames} visible={false}>
        <planeGeometry args={[1.36, 1.22]} />
      </mesh>
      <sprite ref={glow} position={[0, 0.72, 0.7]} scale={[3.6, 3.2, 1]} visible={false}>
        <spriteMaterial map={assets.glow} color="#ff8a3c" transparent blending={AdditiveBlending} depthWrite={false} opacity={0} />
      </sprite>
      {/* Книги и часы на каминной полке */}
      {[[-0.92, '#6a2d33', 0.15], [-0.72, '#2f4a42', -0.1], [0.84, '#7a5426', 0.2]].map(([x, color, turn], i) => (
        <mesh key={i} position={[x as number, 1.84, 0.2]} rotation={[0, turn as number, 0]}>
          <boxGeometry args={[0.1, 0.26, 0.2]} />
          <meshStandardMaterial color={color as string} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
