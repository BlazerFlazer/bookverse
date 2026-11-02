import { Color, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { rt } from '../world/runtime.ts';
import { ALCOVE, FIREPLACE, HALL, hallEndZ, WINDOW_BAYS, bayCenterZ } from '../world/library/layout.ts';

/**
 * Общие значения света. Один объект на все материалы зала: обновление раз за кадр стоит одну запись,
 * а шейдеры не пересобираются. Тысячи книг и досок меняют свет вместе, без лишних источников.
 */
export const atmosUniforms = {
  uAtmosLamp: { value: new Color(1, 1, 1) },
  uAtmosDay: { value: new Color() },
  uAtmosFire: { value: new Color() },
  uAtmosFlash: { value: 0 },
};

const FIRE_TINT = new Color('#ff8a3c');
const WHITE = new Color(1, 1, 1);
const scratch = new Color();

/** Запечённый свет уже тёплый, поэтому цвет лампы лишь немного подкрашивает его. */
const LAMP_NEUTRAL = 0.76;

/** Переносит кадр атмосферы в общие значения шейдеров. */
export function syncLighting(): void {
  const { frame, flash } = rt.atmos;
  atmosUniforms.uAtmosLamp.value.copy(frame.lampColor).lerp(WHITE, LAMP_NEUTRAL).multiplyScalar(frame.lamp);
  atmosUniforms.uAtmosDay.value.copy(frame.daylightColor).multiplyScalar(frame.daylight);
  const flicker = 1 + rt.atmos.motion * (Math.sin(rt.atmos.rainTime * 9.3) * 0.08 + Math.sin(rt.atmos.rainTime * 23.1) * 0.05);
  atmosUniforms.uAtmosFire.value.copy(scratch.copy(FIRE_TINT)).multiplyScalar(frame.fire * flicker * 0.62);
  atmosUniforms.uAtmosFlash.value = flash;
}

const glslFloat = (value: number) => value.toFixed(3);

const VERTEX_HEAD = /* glsl */ `
  varying vec3 vAtmosPos;
`;

const VERTEX_BODY = /* glsl */ `
  vec4 atmosPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    atmosPosition = instanceMatrix * atmosPosition;
  #endif
  vAtmosPos = (modelMatrix * atmosPosition).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
  varying vec3 vAtmosPos;
  uniform vec3 uAtmosLamp;
  uniform vec3 uAtmosDay;
  uniform vec3 uAtmosFire;
  uniform float uAtmosFlash;

  // Свет из окон считается по положению точки, а не источниками: окон много, а стоит это как одна формула.
  float atmosWindows(vec3 p) {
    float toEnd = clamp(1.0 - (p.z - ${glslFloat(hallEndZ)}) / 30.0, 0.0, 1.0);
    float far = toEnd * toEnd * (0.55 + 0.45 * clamp(p.y / 9.0, 0.0, 1.0));
    float rhythm = 0.5 + 0.5 * cos((p.z - ${glslFloat(bayCenterZ(WINDOW_BAYS[0]!))}) * ${glslFloat(Math.PI / HALL.bay)});
    float high = 0.26 + 0.6 * smoothstep(1.0, 8.0, p.y);
    float reach = smoothstep(2.0, 7.0, 6.2 - p.z + 8.0);
    vec3 toNiche = p - vec3(${glslFloat(ALCOVE.x)}, 2.5, ${glslFloat(ALCOVE.z)});
    float niche = 1.0 / (1.0 + dot(toNiche, toNiche) * 0.14);
    return far * 1.1 + (0.35 + 0.65 * rhythm) * high * reach * 0.62 + niche * 1.3;
  }

  vec3 atmosRoom(vec3 p) {
    float windows = atmosWindows(p);
    vec3 toFire = p - vec3(${glslFloat(FIREPLACE.x + 0.5)}, 0.7, ${glslFloat(FIREPLACE.z)});
    float fire = 1.0 / (1.0 + dot(toFire, toFire) * 0.2);
    return uAtmosDay * windows + uAtmosFire * fire + vec3(0.46, 0.58, 0.82) * uAtmosFlash * windows * 0.42;
  }
`;

const FRAGMENT_BODY = /* glsl */ `
  vec3 atmosAlbedo = diffuseColor.rgb;
  diffuseColor.rgb *= uAtmosLamp;
  totalEmissiveRadiance += atmosAlbedo * atmosRoom(vAtmosPos);
`;

/**
 * Подключает материал к свету живой библиотеки. Ключ нужен three, чтобы материалы с разной
 * дополнительной обработкой не делили одну программу.
 */
export function withAtmosphere<T extends MeshStandardMaterial>(material: T, key: string): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, atmosUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_BODY}`);
  };
  material.customProgramCacheKey = () => `atmos-${key}`;
  return material;
}
