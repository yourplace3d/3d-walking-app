/**
 * The fog: where nobody has walked, the model is plain parchment, the same colour as the page, so
 * nothing shows there (no terrain, no buildings, no streets). Where the reveal mask is open the
 * map shows as normal. The edge is made ragged with a little noise and inked, like the coast of
 * an old chart. Buildings appear whole, once the middle of their footprint is revealed.
 */

import { Color, DataTexture, LinearFilter, MeshDepthMaterial, RedFormat, RGBADepthPacking, UnsignedByteType, type BufferGeometry, type IUniform, type Mesh, type MeshStandardMaterial, type Texture } from 'three';
import type { RevealMask } from './reveal';

/** Parchment, as the page's background (sRGB). Keep in step with --paper in styles.css. */
export const PAPER = '#efe6d2';
/** The inked edge of the revealed map. */
export const INK = '#8a6d4a';

export interface FogUniforms {
  uFogMap: IUniform<Texture>;
  /** half the side of the loaded square (m) */
  uFogHalf: IUniform<number>;
  uPaper: IUniform<Color>;
  uInk: IUniform<Color>;
  /** 1 = fog on; 0 shows the whole square (tests, and the map of all walks if wanted later) */
  uFogOn: IUniform<number>;
}

export class Fog {
  readonly texture: DataTexture;
  readonly uniforms: FogUniforms;

  constructor(readonly mask: RevealMask) {
    this.texture = new DataTexture(mask.data, mask.px, mask.px, RedFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uFogMap: { value: this.texture },
      uFogHalf: { value: mask.sizeM / 2 },
      // raw sRGB on purpose: the colour is written after tone mapping and colour conversion,
      // so it matches the page exactly
      uPaper: { value: new Color().setRGB(...srgb(PAPER)) },
      uInk: { value: new Color().setRGB(...srgb(INK)) },
      uFogOn: { value: 1 },
    };
  }

  /** Call after the mask changed. */
  update(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function srgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const COMMON = `
uniform sampler2D uFogMap;
uniform float uFogHalf;
uniform float uFogOn;
float fogReveal(vec2 xz) {
  vec2 uv = vec2((xz.x + uFogHalf), (xz.y + uFogHalf)) / (2.0 * uFogHalf);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0 - uFogOn;
  return max(texture2D(uFogMap, uv).r, 1.0 - uFogOn);
}`;

const NOISE = `
float fogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fogNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fogHash(i), fogHash(i + vec2(1.0, 0.0)), u.x), mix(fogHash(i + vec2(0.0, 1.0)), fogHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** Chain a patch after the material's own (the engine's contour lines, wall shading). */
function chain(mat: MeshStandardMaterial | MeshDepthMaterial, key: string, patch: (shader: Parameters<MeshStandardMaterial['onBeforeCompile']>[0]) => void): void {
  const prev = mat.onBeforeCompile.bind(mat);
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    patch(shader);
  };
  mat.customProgramCacheKey = () => `${baseKey}|${key}`;
  mat.needsUpdate = true;
}

/** The ground: parchment where unrevealed, the map where revealed, a ragged inked edge between. */
export function fogGround(mat: MeshStandardMaterial, u: FogUniforms): void {
  chain(mat, 'fog-ground', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFogXZ;\nuniform vec3 uPaper;\nuniform vec3 uInk;${COMMON}${NOISE}`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
{
  float m = fogReveal(vFogXZ);
  float wobble = (fogNoise(vFogXZ / 9.0) - 0.5) * 0.55 + (fogNoise(vFogXZ / 2.5) - 0.5) * 0.2;
  float k = smoothstep(0.42, 0.58, m + wobble * step(0.01, m) * step(m, 0.99));
  float grain = 0.985 + 0.03 * fogNoise(vFogXZ / 1.3);
  vec3 paper = uPaper * mix(1.0, grain, 1.0 - k);
  float rim = (1.0 - abs(k * 2.0 - 1.0)) * uFogOn;
  vec3 col = mix(paper, gl_FragColor.rgb, k);
  gl_FragColor.rgb = mix(col, uInk, rim * 0.55);
}`,
      );
  });
}

const BUILDING_VERTEX = (shader: { vertexShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec2 aFoot;\nvarying float vFogShow;${COMMON}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogShow = fogReveal(aFoot);');
};
const BUILDING_FRAGMENT = (shader: { fragmentShader: string }) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFogShow;')
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFogShow < 0.5) discard;');
};

/**
 * Buildings: shown whole once the middle of the footprint is revealed, else not drawn at all. Their
 * shadows follow (a hidden building casting a shadow would give it away).
 */
export function fogBuildings(mesh: Mesh<BufferGeometry, MeshStandardMaterial>, u: FogUniforms): void {
  const patch = (shader: Parameters<MeshStandardMaterial['onBeforeCompile']>[0]) => {
    Object.assign(shader.uniforms, u);
    BUILDING_VERTEX(shader);
    BUILDING_FRAGMENT(shader);
  };
  chain(mesh.material, 'fog-bldg', patch);
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  chain(depth, 'fog-bldg-depth', patch);
  mesh.customDepthMaterial = depth;
}
