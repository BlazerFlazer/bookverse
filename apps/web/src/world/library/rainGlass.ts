import { Color, ShaderMaterial, Vector2, type Texture } from 'three';
import { rt } from '../runtime.ts';

/**
 * Общие значения всех окон. Вид за окном не рендерится отдельной камерой: он собирается
 * из одной маленькой текстуры с масками прямо в шейдере стекла, поэтому окно стоит как один материал.
 */
export const glassUniforms = {
  uRainTime: { value: 0 },
  uRain: { value: 0.7 },
  uLayers: { value: 2 },
  uSkyTop: { value: new Color() },
  uSkyLow: { value: new Color() },
  uHaze: { value: new Color() },
  uInterior: { value: new Color() },
  uWindowLight: { value: 1 },
  uReflect: { value: 0.1 },
  uFlash: { value: 0 },
  uMotion: { value: 1 },
};

export function syncGlass(): void {
  const { frame, rain, rainTime, flash, layers, motion } = rt.atmos;
  glassUniforms.uRainTime.value = rainTime;
  glassUniforms.uRain.value = rain;
  glassUniforms.uLayers.value = layers;
  glassUniforms.uSkyTop.value.copy(frame.skyTop);
  glassUniforms.uSkyLow.value.copy(frame.skyLow);
  glassUniforms.uHaze.value.copy(frame.haze);
  glassUniforms.uInterior.value.copy(frame.lampColor).multiplyScalar(frame.lamp);
  glassUniforms.uWindowLight.value = frame.window;
  glassUniforms.uReflect.value = frame.reflect;
  glassUniforms.uFlash.value = flash;
  glassUniforms.uMotion.value = motion;
}

const VERTEX = /* glsl */ `
  uniform vec2 uSize;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec2 vMeters;
  varying vec2 vParallax;
  varying float vSeed;

  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vSeed = uSeed;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      tangent = mat3(instanceMatrix) * tangent;
      vSeed += float(gl_InstanceID) * 7.31;
    #endif
    vec4 world = modelMatrix * local;
    tangent = normalize(mat3(modelMatrix) * tangent);
    vec3 view = normalize(world.xyz - cameraPosition);
    // Вид за окном далеко, поэтому он сдвигается вместе с направлением взгляда, а не с рамой.
    vParallax = vec2(dot(view, tangent), view.y);
    vUv = position.xy / uSize + vec2(0.5, 0.0);
    vMeters = position.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uExterior;
  uniform vec2 uSize;
  uniform float uDropScale;
  uniform float uViewScale;
  uniform float uBarWidth;
  uniform vec2 uBarCell;
  uniform float uRainTime;
  uniform float uRain;
  uniform float uLayers;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyLow;
  uniform vec3 uHaze;
  uniform vec3 uInterior;
  uniform float uWindowLight;
  uniform float uReflect;
  uniform float uFlash;
  uniform float uMotion;
  varying vec2 vUv;
  varying vec2 vMeters;
  varying vec2 vParallax;
  varying float vSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 hash3(vec2 p) {
    float a = hash(p);
    return vec3(a, hash(p + a + 1.7), hash(p + a * 3.1 + 5.3));
  }

  // Мелкие капли на стекле: появляются, держатся и высыхают на месте.
  // xy — смещение, как у маленькой линзы, z — где капля есть.
  vec3 beads(vec2 p, float t, float amount) {
    vec2 id = floor(p);
    vec3 r = hash3(id);
    vec2 center = fract(p) - 0.5 - (r.xy - 0.5) * 0.6;
    float life = fract(t * (0.05 + r.z * 0.06) + r.x * 7.0);
    float alive = step(r.z, amount) * smoothstep(0.0, 0.06, life) * smoothstep(1.0, 0.72, life);
    float radius = (0.08 + r.y * r.y * 0.2) * alive;
    float mask = radius > 0.0 ? smoothstep(radius, radius * 0.58, length(center)) : 0.0;
    return vec3(center / max(radius, 0.02) * mask, mask);
  }

  // Стекающая капля. У каждого узкого столбца своя скорость, а сама капля то замирает,
  // то срывается вниз и оставляет влажный след. xy — смещение, z — капля, w — след.
  vec4 runner(vec2 p, float t, float amount) {
    const float STRETCH = 5.0;
    vec2 g = vec2(p.x, p.y / STRETCH);
    float column = floor(g.x);
    float speed = hash(vec2(column, 3.7));
    float time = t * (0.1 + speed * 0.16);
    // Рывки: равномерное время искажается так, что капля то почти стоит, то бежит.
    g.y += time + sin(time * 5.0 + speed * 40.0) * 0.1 + speed * 9.0;
    vec2 id = vec2(column, floor(g.y));
    vec3 r = hash3(id);
    if (r.z > amount) return vec4(0.0);
    vec2 cell = fract(g);
    float x = 0.5 + (r.x - 0.5) * 0.56 + sin(p.y * 2.3 + r.y * 6.3) * 0.05 * (r.y - 0.3);
    float head = 0.14 + r.y * 0.22;
    float radius = 0.13 + r.x * 0.1;
    vec2 q = vec2(cell.x - x, (cell.y - head) * STRETCH);
    // Капля тяжелее снизу: сверху она вытянута.
    q.y *= q.y > 0.0 ? 0.5 : 1.08;
    float drop = smoothstep(radius, radius * 0.55, length(q));
    float side = abs(cell.x - x);
    float above = smoothstep(head, head + 0.02, cell.y) * smoothstep(0.96, head + 0.1, cell.y);
    float trail = smoothstep(radius * 0.72, radius * 0.1, side) * above;
    // Вдоль следа остаётся цепочка совсем мелких капелек.
    float beadY = fract(cell.y * 13.0 + r.z * 5.0) - 0.5;
    float crumbs = smoothstep(0.24, 0.1, length(vec2((cell.x - x) * 9.0, beadY))) * above * step(0.4, r.x);
    return vec4(q / radius * drop + vec2(cell.x - x, beadY * 0.2) * crumbs * 3.0, max(drop, crumbs * 0.8), trail);
  }

  vec3 outside(vec2 uv, float lod) {
    vec3 mask = textureLod(uExterior, uv, lod).rgb;
    float y = clamp(uv.y, 0.0, 1.0);
    vec3 sky = mix(uSkyLow, uSkyTop, smoothstep(0.16, 0.92, y));
    sky *= 0.9 + 0.26 * mask.r;
    // Даль растворяется в дымке дождя, ближние деревья темнее и отделяются от неба.
    vec3 color = mix(sky, mix(sky, uHaze, 0.74) * 0.84, mask.g);
    color = mix(color, uHaze * 0.42, mask.b);
    // Мокрая земля отражает небо пятнами.
    float ground = smoothstep(0.215, 0.2, y);
    float puddles = smoothstep(0.42, 0.72, mask.r);
    color = mix(color, mix(uHaze * 0.3, uSkyLow * 0.8, puddles), ground);
    return color;
  }

  float line(float value, float period, float width) {
    float distance = abs(fract(value / period + 0.5) - 0.5) * period;
    return 1.0 - smoothstep(width, width + fwidth(value) * 1.4, distance);
  }

  // Переплёт: прямоугольные стёкла внизу, веер в арке.
  float glazing(vec2 m) {
    float spring = uSize.y - uSize.x * 0.5;
    vec2 q = m - vec2(0.0, spring);
    float bar = 1.0 - smoothstep(uBarWidth * 1.4, uBarWidth * 1.4 + fwidth(m.y) * 1.4, abs(q.y));
    if (q.y < 0.0) return max(bar, max(line(m.x, uBarCell.x, uBarWidth), line(m.y, uBarCell.y, uBarWidth)));
    float radius = length(q);
    float ring = 1.0 - smoothstep(uBarWidth, uBarWidth + fwidth(radius) * 1.4, abs(radius - uSize.x * 0.3));
    float spokes = radius > uSize.x * 0.3 ? 0.7854 : 1.5708;
    return max(bar, max(ring, line(atan(q.x, q.y), spokes, uBarWidth / radius)));
  }

  float softSpot(vec2 uv, vec2 center, float size) {
    vec2 d = (uv - center) / size;
    return exp(-dot(d, d));
  }

  void main() {
    vec2 m = vMeters * uDropScale + vec2(vSeed * 3.1, vSeed * 1.7);
    float t = uRainTime;
    float wet = clamp(uRain, 0.0, 1.4);

    vec4 big = runner(m, t, 0.3 + wet * 0.5);
    vec2 bend = big.xy;
    float clear = max(big.z, big.w * 0.9);
    vec3 small = beads(m * 3.2 + 11.3, t, 0.26 + wet * 0.5);
    bend += small.xy * 0.55;
    clear = max(clear, small.z);

    if (uLayers > 1.5) {
      vec4 second = runner(m * 1.9 + vec2(13.7, 4.1), t * 1.2, 0.24 + wet * 0.5);
      bend += second.xy * 0.7;
      clear = max(clear, max(second.z, second.w * 0.8));
    }
    if (uLayers > 2.5) {
      vec3 fine = beads(m * 6.4 + 31.9, t * 1.3, 0.3 + wet * 0.4);
      bend += fine.xy * 0.3;
      clear = max(clear, fine.z * 0.8);
    }

    // Запотевшее стекло размывает улицу, а капли и следы протирают чистые полоски.
    vec2 view = vec2((vUv.x - 0.5) * uSize.x, vUv.y * uSize.y) * uViewScale + vec2(0.5 + vSeed * 0.137, 0.1);
    view += vParallax * vec2(0.34, 0.2);
    vec2 refract = bend * 0.03;
    vec3 color = outside(view + refract, mix(3.5, 0.5, clear));

    // Косые нити дождя за стеклом: видны только там, где стекло чистое или дождь сильный.
    if (uLayers > 1.5) {
      vec2 fall = vec2(view.x * 70.0 + view.y * 9.0, view.y * 5.0 + t * 7.0);
      float thread = smoothstep(0.92, 1.0, hash(floor(fall))) * smoothstep(0.0, 0.5, fract(fall.y));
      color += mix(uSkyLow, vec3(1.0), 0.2) * thread * (0.03 + 0.05 * wet) * uMotion;
    }
    color *= uWindowLight;

    // Стекло отражает зал. Днём этого почти не видно, ночью проступают лампы.
    vec2 mirror = vec2(vUv.x, vUv.y) + refract * 2.0;
    float lamps = softSpot(mirror, vec2(0.3, 0.7), 0.05) + softSpot(mirror, vec2(0.68, 0.58), 0.04) + softSpot(mirror, vec2(0.46, 0.36), 0.07) * 0.7;
    float room = 0.12 + 0.5 * smoothstep(0.6, 0.0, vUv.y);
    color += uInterior * uReflect * (room * 0.1 + lamps * 0.7) * mix(1.0, 0.6, clear);
    // Блик в капле: она собирает свет и чуть светлее мутного стекла.
    color += (uSkyLow * uWindowLight * 0.26 + uInterior * uReflect * 0.12) * clear * smoothstep(0.0, 1.0, bend.y * 0.5 + 0.5);
    color += vec3(0.62, 0.72, 0.95) * uFlash * (0.5 + 0.5 * smoothstep(0.1, 0.8, vUv.y));

    float bar = clamp(glazing(vMeters), 0.0, 1.0);
    color = mix(color, uInterior * 0.03 + uSkyLow * uWindowLight * 0.05, bar);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface GlassOptions {
  size: [number, number];
  exterior: Texture;
  /** Капель на метр: дальние окна видны издалека, и капли на них условно крупнее. */
  dropScale: number;
  /** Сколько вида за окном попадает на метр стекла. */
  viewScale: number;
  barWidth: number;
  barCell: [number, number];
  seed: number;
}

export function glassMaterial({ size, exterior, dropScale, viewScale, barWidth, barCell, seed }: GlassOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...glassUniforms,
      uExterior: { value: exterior },
      uSize: { value: new Vector2(...size) },
      uDropScale: { value: dropScale },
      uViewScale: { value: viewScale },
      uBarWidth: { value: barWidth },
      uBarCell: { value: new Vector2(...barCell) },
      uSeed: { value: seed },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });
}
