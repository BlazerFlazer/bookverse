import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
} from 'three';
import { rt } from '../runtime.ts';
import { mulberry } from '../textures/noise.ts';

/**
 * Траектория считается в вершинном шейдере от одного набора значений: процессор не тратит
 * ни такта на каждый лист, и сотни листов дают один вызов отрисовки.
 * Движение разбито на три фазы: выброс по спирали, орбита вокруг книги, разлёт мимо камеры.
 */
const TRAJECTORY = /* glsl */ `
  uniform float uTime;
  uniform float uBurst;
  uniform float uOrbit;
  uniform float uScatter;
  uniform float uRadius;
  uniform float uHeight;
  uniform vec3 uCenter;
  attribute vec4 aSeed;

  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }

  float easeOutCubic(float t) { float f = 1.0 - t; return 1.0 - f * f * f; }

  vec3 orbitPosition(vec4 a, float t) {
    float direction = a.z > 0.18 ? 1.0 : -1.0;
    float radius = uRadius * mix(0.62, 1.75, a.x * a.x);
    float angle = a.y * 6.2832 + t * mix(0.3, 0.86, a.w) * direction;
    float wave = sin(t * 0.8 + a.y * 19.0) * 0.16 * uHeight;
    float height = (a.z - 0.5) * uHeight + wave;
    return vec3(cos(angle) * radius, height, sin(angle) * radius);
  }

  vec3 flightOffset(vec4 a) {
    float start = a.w * 0.34;
    float s = clamp((uBurst - start) / 0.66, 0.0, 1.0);
    vec3 ring = orbitPosition(a, uTime + (1.0 - easeOutCubic(s)) * 5.0);
    vec3 p = ring * easeOutCubic(s);
    // Сначала лист вылетает вверх из разворота, а потом уходит на орбиту.
    p.y += sin(s * 3.1416) * 0.5 * (0.4 + a.x) * uHeight * (1.0 - uOrbit * 0.6);
    // Разлёт: лист ускоряется наружу и мимо камеры.
    float leave = clamp((uScatter * 1.5 - a.w * 0.5), 0.0, 1.0);
    leave = leave * leave;
    vec3 outward = normalize(vec3(ring.x, ring.y * 0.4 + 0.2, ring.z) + 0.0001);
    p += outward * leave * uRadius * 9.0;
    return p;
  }
`;

const paperVertex = /* glsl */ `
  ${TRAJECTORY}
  uniform float uScale;
  varying vec2 vUv;
  varying float vLight;
  varying float vAlpha;
  varying float vFog;

  void main() {
    vUv = uv;
    float t = uTime * (0.9 + aSeed.w * 0.7) + aSeed.y * 40.0;
    vec3 sheet = position * uScale * mix(0.72, 1.18, aSeed.x);
    // Трепетание: волна по диагонали листа.
    float wave = sin(position.x * 4.2 + position.y * 2.4 + t * 2.6) * 0.09 * uScale;
    sheet.z += wave;
    mat3 tumble = rotY(t * 0.7 + aSeed.z * 6.3) * rotX(sin(t * 0.5 + aSeed.y * 6.3) * 1.3 + 0.5) * rotZ(sin(t * 0.33) * 0.8);
    vec3 world = tumble * sheet + flightOffset(aSeed) + uCenter;
    float s = clamp((uBurst - aSeed.w * 0.34) / 0.66, 0.0, 1.0);
    vAlpha = smoothstep(0.0, 0.1, s);
    vec3 normal = tumble * vec3(0.0, 0.0, 1.0);
    // Лист светится от книги: чем ближе к центру, тем теплее.
    vLight = 0.5 + 0.5 * abs(dot(normal, normalize(vec3(0.3, 0.7, 0.6))));
    vec4 view = viewMatrix * vec4(world, 1.0);
    vFog = 1.0 - exp(-0.0016 * dot(view.xyz, view.xyz));
    gl_Position = projectionMatrix * view;
  }
`;

const paperFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uFogColor;
  varying vec2 vUv;
  varying float vLight;
  varying float vAlpha;
  varying float vFog;

  void main() {
    if (vAlpha * uOpacity < 0.02) discard;
    vec3 paper = texture2D(uMap, vUv).rgb;
    vec3 color = paper * uTint * vLight;
    color += vec3(0.28, 0.17, 0.06) * (1.0 - vLight) * 0.9;
    gl_FragColor = vec4(mix(color, uFogColor, vFog), vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

const bookVertex = /* glsl */ `
  ${TRAJECTORY}
  uniform float uScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vAlpha;

  void main() {
    vec4 s = aSeed;
    float t = uTime * (0.5 + s.w * 0.4) + s.y * 40.0;
    mat3 tumble = rotY(t * 0.5 + s.z * 6.3) * rotX(sin(t * 0.3 + s.y * 6.3) * 0.9) * rotZ(t * 0.2);
    vec3 world = tumble * (position * uScale * mix(0.7, 1.2, s.x)) + flightOffset(s) + uCenter;
    float p = clamp((uBurst - s.w * 0.34) / 0.66, 0.0, 1.0);
    vAlpha = smoothstep(0.0, 0.18, p);
    vNormalW = tumble * normal;
    // Торцы блока светлые, как срез страниц; обложка окрашена по экземпляру.
    float isPages = step(0.5, color.r);
    vColor = mix(aColor, vec3(0.86, 0.77, 0.6), isPages);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const bookFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vAlpha;

  void main() {
    if (vAlpha * uOpacity < 0.04) discard;
    float light = 0.32 + 0.68 * max(dot(normalize(vNormalW), normalize(vec3(0.3, 0.8, 0.5))), 0.0);
    gl_FragColor = vec4(vColor * light + vColor * 0.12, vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

function seeds(count: number, seed: number): InstancedBufferAttribute {
  const rand = mulberry(seed);
  const array = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i += 1) array[i] = rand();
  return new InstancedBufferAttribute(array, 4);
}

function useShared() {
  return useMemo(
    () => ({
      uTime: { value: 0 },
      uBurst: { value: 0 },
      uOrbit: { value: 0 },
      uScatter: { value: 0 },
      uRadius: { value: 1.6 },
      uHeight: { value: 2.4 },
      uCenter: { value: rt.vortex.center },
      uOpacity: { value: 0 },
      uScale: { value: 1 },
    }),
    [],
  );
}

export function PaperVortex({ count, paper, fogColor }: { count: number; paper: Texture; fogColor: string }) {
  const mesh = useRef<Mesh>(null);
  const shared = useShared();

  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(0.34, 0.46, 5, 4);
    const instanced = new InstancedBufferGeometry();
    instanced.index = plane.index;
    instanced.setAttribute('position', plane.getAttribute('position'));
    instanced.setAttribute('uv', plane.getAttribute('uv'));
    instanced.setAttribute('aSeed', seeds(count, 41));
    instanced.instanceCount = count;
    return instanced;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: paperVertex,
        fragmentShader: paperFragment,
        side: DoubleSide,
        transparent: true,
        uniforms: {
          ...shared,
          uMap: { value: paper },
          uTint: { value: new Color('#fff2d6') },
          uFogColor: { value: new Color(fogColor) },
        },
      }),
    [paper, shared, fogColor],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    const v = rt.vortex;
    const active = v.opacity > 0.001;
    if (mesh.current) mesh.current.visible = active;
    if (!active) return;
    shared.uTime.value += delta * (1 + v.orbit * 0.5);
    shared.uBurst.value = v.burst;
    shared.uOrbit.value = v.orbit;
    shared.uScatter.value = v.scatter;
    shared.uRadius.value = v.radius;
    shared.uHeight.value = v.height;
    shared.uOpacity.value = v.opacity;
    shared.uScale.value = v.scale;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} visible={false} renderOrder={5} />;
}

const LEATHERS = ['#6a2d33', '#2f4a42', '#3b2a4f', '#7a5426', '#29384f', '#58252b', '#23423a'];

export function FlyingBooks({ count }: { count: number }) {
  const mesh = useRef<Mesh>(null);
  const shared = useShared();

  const geometry = useMemo(() => {
    const box = new BoxGeometry(0.36, 0.48, 0.09);
    // Вершинный цвет отмечает боковые грани: они становятся срезом страниц.
    const colors = new Float32Array(box.getAttribute('position').count * 3);
    const normal = box.getAttribute('normal');
    for (let i = 0; i < normal.count; i += 1) {
      const isCover = Math.abs(normal.getZ(i)) > 0.5 || normal.getX(i) < -0.5;
      colors[i * 3] = isCover ? 0 : 1;
    }
    const instanced = new InstancedBufferGeometry();
    instanced.index = box.index;
    instanced.setAttribute('position', box.getAttribute('position'));
    instanced.setAttribute('normal', box.getAttribute('normal'));
    instanced.setAttribute('uv', box.getAttribute('uv'));
    instanced.setAttribute('color', new BufferAttribute(colors, 3));
    instanced.setAttribute('aSeed', seeds(count, 77));
    const tints = new Float32Array(count * 3);
    const rand = mulberry(5);
    for (let i = 0; i < count; i += 1) {
      const c = new Color(LEATHERS[Math.floor(rand() * LEATHERS.length)]!);
      tints.set([c.r, c.g, c.b], i * 3);
    }
    instanced.setAttribute('aColor', new InstancedBufferAttribute(tints, 3));
    instanced.instanceCount = count;
    return instanced;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: bookVertex,
        fragmentShader: bookFragment,
        transparent: true,
        vertexColors: true,
        uniforms: { ...shared },
      }),
    [shared],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    const v = rt.vortex;
    const active = v.books > 0.001;
    if (mesh.current) mesh.current.visible = active;
    if (!active) return;
    shared.uTime.value += delta;
    shared.uBurst.value = v.burst;
    shared.uOrbit.value = v.orbit;
    shared.uScatter.value = v.scatter;
    shared.uRadius.value = v.radius * 1.2;
    shared.uHeight.value = v.height * 0.8;
    shared.uOpacity.value = v.books;
    shared.uScale.value = v.scale * 1.15;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} visible={false} renderOrder={4} />;
}
