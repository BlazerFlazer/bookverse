import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import { rt } from '../runtime.ts';
import { mulberry } from '../textures/noise.ts';

/** Пыль в луче света. Частицы живут в шейдере, а на процессор приходится только счётчик времени. */
export function GoldDust({ count, area, center, strength }: { count: number; area: [number, number, number]; center: [number, number, number]; strength: () => number }) {
  const points = useRef<Points>(null);

  const geometry = useMemo(() => {
    const rand = mulberry(13);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (rand() - 0.5) * area[0];
      positions[i * 3 + 1] = (rand() - 0.5) * area[1];
      positions[i * 3 + 2] = (rand() - 0.5) * area[2];
      seeds[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    return g;
  }, [count, area]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPixel: { value: 1 }, uHeight: { value: area[1] } },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uPixel;
          uniform float uHeight;
          attribute float aSeed;
          varying float vTwinkle;
          void main() {
            vec3 p = position;
            float t = uTime * (0.05 + aSeed * 0.09);
            p.y = mod(p.y + uHeight * 0.5 + t * 3.0, uHeight) - uHeight * 0.5;
            p.x += sin(uTime * 0.25 + aSeed * 40.0) * 0.28;
            p.z += cos(uTime * 0.2 + aSeed * 31.0) * 0.28;
            vTwinkle = 0.45 + 0.55 * sin(uTime * (0.6 + aSeed) + aSeed * 100.0);
            vec4 view = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uPixel * (10.0 + 26.0 * aSeed * aSeed) / max(0.6, -view.z);
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          varying float vTwinkle;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.05, d);
            gl_FragColor = vec4(vec3(1.0, 0.78, 0.46), a * a * uOpacity * max(vTwinkle, 0.0));
          }
        `,
      }),
    [area],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state, delta) => {
    const value = strength();
    if (points.current) points.current.visible = value > 0.001;
    if (value <= 0.001) return;
    material.uniforms.uTime!.value += delta;
    material.uniforms.uOpacity!.value = value;
    material.uniforms.uPixel!.value = state.viewport.dpr;
  });

  return <points ref={points} geometry={geometry} material={material} position={center} frustumCulled={false} />;
}

/** Круговая волна раскрытия книги. */
export function Shockwave() {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: { uProgress: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uProgress;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float angle = atan(vUv.y, vUv.x);
            float ripple = sin(angle * 9.0) * 0.008 + sin(angle * 23.0 + uProgress * 9.0) * 0.005;
            float head = uProgress * 0.92;
            float band = smoothstep(0.075, 0.0, abs(r + ripple - head));
            float trail = smoothstep(head, head - 0.32, r) * smoothstep(head - 0.7, head - 0.32, r) * 0.16;
            float fade = (1.0 - uProgress) * (1.0 - uProgress);
            vec3 color = mix(vec3(1.0, 0.62, 0.24), vec3(1.0, 0.92, 0.74), band);
            gl_FragColor = vec4(color, (band + trail) * fade * 1.6);
          }
        `,
      }),
    [],
  );

  useFrame(() => {
    const s = rt.shock;
    if (!mesh.current) return;
    mesh.current.visible = s.progress > 0.001 && s.progress < 0.999;
    if (!mesh.current.visible) return;
    material.uniforms.uProgress!.value = s.progress;
    mesh.current.position.copy(s.center);
    mesh.current.scale.setScalar(s.scale);
  });

  return (
    <mesh ref={mesh} material={material} visible={false} renderOrder={6}>
      <planeGeometry args={[12, 12]} />
    </mesh>
  );
}

/** Ленты золотого света вокруг книги: полоса навита на спираль прямо в вершинном шейдере. */
export function Ribbons({ count }: { count: number }) {
  const meshes = useRef<(Mesh | null)[]>([]);
  const geometry = useMemo(() => new PlaneGeometry(1, 1, 96, 1), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uHead: { value: 0 },
          uOpacity: { value: 0 },
          uRadius: { value: 1.2 },
          uHeight: { value: 1.8 },
          uCenter: { value: rt.ribbons.center },
        },
        vertexShader: /* glsl */ `
          uniform float uHead;
          uniform float uRadius;
          uniform float uHeight;
          uniform vec3 uCenter;
          varying float vAlong;
          varying float vAcross;
          void main() {
            float s = uv.x;
            vec4 turn = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float phase = turn.x;
            float angle = s * 13.0 + phase + uHead * 5.0;
            float grow = 0.72 + 0.34 * sin(s * 3.14159);
            float radius = uRadius * grow;
            float y = (s - 0.5) * uHeight;
            vec3 center = vec3(cos(angle) * radius, y, sin(angle) * radius);
            float width = 0.08 * (uv.y - 0.5) * uRadius;
            vec3 p = center + vec3(0.0, width, 0.0) + vec3(cos(angle) * width * 0.5, 0.0, sin(angle) * width * 0.5);
            vAlong = s;
            vAcross = uv.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(p + uCenter, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uHead;
          uniform float uOpacity;
          varying float vAlong;
          varying float vAcross;
          void main() {
            float tail = smoothstep(uHead - 0.5, uHead, vAlong) * smoothstep(uHead + 0.03, uHead, vAlong);
            float across = 1.0 - abs(vAcross - 0.5) * 2.0;
            float core = across * across;
            vec3 color = mix(vec3(0.95, 0.56, 0.16), vec3(1.0, 0.93, 0.72), core);
            gl_FragColor = vec4(color, tail * core * uOpacity);
          }
        `,
      }),
    [],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(() => {
    const r = rt.ribbons;
    const visible = r.opacity > 0.001;
    for (const mesh of meshes.current) if (mesh) mesh.visible = visible;
    if (!visible) return;
    material.uniforms.uHead!.value = r.head;
    material.uniforms.uOpacity!.value = r.opacity;
    material.uniforms.uRadius!.value = r.radius;
    material.uniforms.uHeight!.value = r.height;
  });

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geometry}
          material={material}
          // Смещение здесь только передаёт в шейдер фазу ленты.
          position={[(i / count) * Math.PI * 2, 0, 0]}
          frustumCulled={false}
          visible={false}
          renderOrder={7}
        />
      ))}
    </>
  );
}

/** Лучи, вырывающиеся из разворота. */
export function LightShafts({ position }: { position: [number, number, number] }) {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec2 p = vec2(vUv.x - 0.5, vUv.y);
            float angle = atan(p.x, p.y + 0.04);
            float rays = 0.55 + 0.45 * sin(angle * 17.0 + uTime * 0.7) * sin(angle * 7.0 - uTime * 0.4);
            float cone = smoothstep(0.62, 0.0, abs(angle));
            float falloff = smoothstep(1.0, 0.04, length(p));
            gl_FragColor = vec4(vec3(1.0, 0.8, 0.48), rays * cone * falloff * falloff * uOpacity * 0.85);
          }
        `,
      }),
    [],
  );

  useFrame((_, delta) => {
    const opacity = rt.shafts.opacity;
    if (!mesh.current) return;
    mesh.current.visible = opacity > 0.001;
    material.uniforms.uOpacity!.value = opacity;
    material.uniforms.uTime!.value += delta;
  });

  return (
    <mesh ref={mesh} material={material} position={position} visible={false} renderOrder={3}>
      <planeGeometry args={[9, 7]} />
    </mesh>
  );
}
