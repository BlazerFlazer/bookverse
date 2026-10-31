import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, InstancedMesh, MeshStandardMaterial, Object3D, PlaneGeometry, type Texture } from 'three';
import { BOOK_H, BOOK_W } from './geometry.ts';

const VERTEX_HEAD = /* glsl */ `
  uniform float uFan;
  uniform float uCount;
  uniform float uGutter;
  uniform float uRightZ;
  uniform float uLeftZ;
  uniform float uPageW;
  uniform float uPageH;
  varying vec2 vPageUv;

  // Лист гнётся по дуге окружности: кривизна максимальна в середине разворота,
  // а свободный край отстаёт, как у настоящей бумаги.
  float pageProgress(float index) {
    float stagger = 0.72;
    float t = clamp((uFan * (1.0 + stagger) - index * stagger), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }
`;

const NORMAL_BODY = /* glsl */ `
  float pageIndex = float(gl_InstanceID) / uCount;
  float pageT = pageProgress(pageIndex);
  float pageAngle = 3.14159265 * pageT;
  float pageKick = 0.72 + 0.28 * fract(sin(pageIndex * 91.7) * 43758.5453);
  float pageK = -1.5 * sin(pageAngle) * pageKick / uPageW;
  float pageS = uv.x * uPageW;
  float pageTheta = pageAngle + pageK * pageS;
  vec3 objectNormal = vec3(-sin(pageTheta), 0.0, cos(pageTheta));
`;

const POSITION_BODY = /* glsl */ `
  vec3 transformed;
  float px, pz;
  if (abs(pageK) < 0.0005) {
    px = pageS * cos(pageAngle);
    pz = pageS * sin(pageAngle);
  } else {
    px = (sin(pageAngle + pageK * pageS) - sin(pageAngle)) / pageK;
    pz = (cos(pageAngle) - cos(pageAngle + pageK * pageS)) / pageK;
  }
  transformed = vec3(uGutter + px, (uv.y - 0.5) * uPageH, mix(uRightZ, uLeftZ, pageT) + pz);
  // Лежащий лист не отличим от стопки, поэтому его не рисуем.
  if (pageT <= 0.001 || pageT >= 0.999) transformed = vec3(0.0);
  vPageUv = pageT < 0.5 ? uv : vec2(1.0 - uv.x, uv.y);
`;

export interface FanUniforms {
  uFan: { value: number };
  uCount: { value: number };
  uGutter: { value: number };
  uRightZ: { value: number };
  uLeftZ: { value: number };
  uPageW: { value: number };
  uPageH: { value: number };
}

/** Листы, которые перелетают при раскрытии. Один вызов отрисовки на весь веер. */
export function PageFan({ count, paper, uniformsRef }: { count: number; paper: Texture; uniformsRef: React.RefObject<FanUniforms | null> }) {
  const mesh = useRef<InstancedMesh>(null);

  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(1, 1, 14, 1);
    return plane;
  }, []);

  const material = useMemo(() => {
    const uniforms: FanUniforms = {
      uFan: { value: 0 },
      uCount: { value: count },
      uGutter: { value: 0 },
      uRightZ: { value: 0 },
      uLeftZ: { value: 0 },
      uPageW: { value: BOOK_W * 0.98 },
      uPageH: { value: BOOK_H * 0.97 },
    };
    uniformsRef.current = uniforms;
    const m = new MeshStandardMaterial({ map: paper, roughness: 0.82, metalness: 0, side: DoubleSide });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = VERTEX_HEAD + shader.vertexShader
        .replace('#include <beginnormal_vertex>', NORMAL_BODY)
        .replace('#include <begin_vertex>', POSITION_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPageUv;')
        .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, vPageUv);');
    };
    m.customProgramCacheKey = () => 'page-fan';
    return m;
  }, [count, paper, uniformsRef]);

  useEffect(() => {
    const dummy = new Object3D();
    const instance = mesh.current;
    if (!instance) return;
    dummy.updateMatrix();
    for (let i = 0; i < count; i += 1) instance.setMatrixAt(i, dummy.matrix);
    instance.instanceMatrix.needsUpdate = true;
  }, [count]);

  useFrame(() => {
    if (mesh.current) mesh.current.visible = (uniformsRef.current?.uFan.value ?? 0) > 0.001 && (uniformsRef.current?.uFan.value ?? 1) < 0.999;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} visible={false} />;
}
