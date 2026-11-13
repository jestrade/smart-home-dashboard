// Floor and ground surfaces, painted on a canvas when the page loads (no image files).
import * as THREE from 'three';
import type { Surface } from './plan';

export type Ground = Surface | 'asphalt' | 'pebble' | 'cladding' | 'brick';

/** Repeatable random numbers, so the house looks the same on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Plain colours: used for the .glb export, where there is no canvas to paint on.
const FLAT: Record<Ground, number> = {
  tile: 0xc3c4c1, wood: 0x9b7653, concrete: 0x9d9e9b, grass: 0x6d9a4c, paving: 0xdcd9d2, gravel: 0xb6b0a5, asphalt: 0x4a4c50,
  pebble: 0xe9e9e4, cladding: 0x8c5d3c, brick: 0xb09779,
};

type Ctx = CanvasRenderingContext2D;
const N = 512;

/** Soft or hard blobs, repeated across the edges so the texture tiles without seams. */
function blobs(c: Ctx, r: () => number, count: number, colors: string[], min: number, max: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = min + r() * (max - min);
    const squash = 0.6 + r() * 0.4;
    const turn = r() * Math.PI;
    c.fillStyle = colors[Math.floor(r() * colors.length)];
    c.globalAlpha = Math.min(1, alpha * (0.5 + r() * 0.5));
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      const px = x + dx;
      const py = y + dy;
      if (px < -rad || px > N + rad || py < -rad || py > N + rad) continue;
      c.beginPath();
      c.ellipse(px, py, rad, rad * squash, turn, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

interface Spec {
  /** Metres covered by one copy of the texture, east–west and north–south. */
  size: [number, number];
  rough: number;
  bump: number;
  draw(c: Ctx, r: () => number): void;
}

const SPECS: Record<Ground, Spec> = {
  // 60 cm porcelain tiles, four to a texture, with thin grout lines.
  tile: {
    size: [1.2, 1.2], rough: 0.38, bump: 0,
    draw(c, r) {
      c.fillStyle = '#c9cac7';
      c.fillRect(0, 0, N, N);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = r() > 0.5 ? '#ffffff' : '#8f9396';
        c.globalAlpha = 0.03 + r() * 0.05;
        c.fillRect((i % 2) * (N / 2), Math.floor(i / 2) * (N / 2), N / 2, N / 2);
      }
      c.globalAlpha = 1;
      blobs(c, r, 50, ['#ffffff', '#9fa3a6'], 30, 90, 0.05);
      blobs(c, r, 700, ['#8d9194', '#e4e5e3'], 0.5, 1.3, 0.12);
      for (const p of [0, N / 2, N]) {
        line(c, p, 0, p, N, '#a2a4a2', 3);
        line(c, 0, p, N, p, '#a2a4a2', 3);
      }
    },
  },
  // Deck boards 14 cm wide, running east–west.
  wood: {
    size: [2.4, 0.56], rough: 0.72, bump: 1.2,
    draw(c, r) {
      const tones = ['#a47c56', '#96704c', '#ad845d', '#8f6944'];
      const h = N / 4;
      for (let row = 0; row < 4; row++) {
        c.fillStyle = tones[(row + Math.floor(r() * 2)) % tones.length];
        c.fillRect(0, row * h, N, h);
        for (let i = 0; i < 45; i++) {
          const y = row * h + 3 + r() * (h - 6);
          c.globalAlpha = 0.05 + r() * 0.1;
          line(c, 0, y, N, y + (r() - 0.5) * 3, r() > 0.3 ? '#5e4129' : '#c9a57c', 0.6 + r());
        }
        c.globalAlpha = 1;
        line(c, 0, row * h, N, row * h, '#3f2d1e', 3);
        const joint = r() * N;
        line(c, joint, row * h, joint, (row + 1) * h, '#3f2d1e', 2);
      }
      line(c, 0, N, N, N, '#3f2d1e', 3);
    },
  },
  concrete: {
    size: [2.4, 2.4], rough: 0.88, bump: 0.6,
    draw(c, r) {
      c.fillStyle = '#a3a4a1';
      c.fillRect(0, 0, N, N);
      blobs(c, r, 70, ['#8a8b88', '#b9bab7'], 40, 120, 0.06);
      blobs(c, r, 2600, ['#7d7e7b', '#c6c7c4'], 0.5, 1.5, 0.2);
      for (const p of [0, N]) {
        line(c, p, 0, p, N, '#7f807d', 3);
        line(c, 0, p, N, p, '#7f807d', 3);
      }
    },
  },
  grass: {
    size: [2, 2], rough: 1, bump: 2.5,
    draw(c, r) {
      c.fillStyle = '#5f8f41';
      c.fillRect(0, 0, N, N);
      blobs(c, r, 90, ['#4f7d35', '#76a552', '#688f3e'], 30, 80, 0.14);
      const greens = ['#4a7a30', '#7fb05a', '#5c8c3d', '#8ab862', '#416d2b'];
      for (let i = 0; i < 6000; i++) {
        const x = r() * N;
        const y = r() * N;
        c.globalAlpha = 0.35 + r() * 0.4;
        line(c, x, y, x + (r() - 0.5) * 4, y - 3 - r() * 5, greens[Math.floor(r() * greens.length)], 1);
      }
      c.globalAlpha = 1;
    },
  },
  gravel: {
    size: [1, 1], rough: 1, bump: 3,
    draw(c, r) {
      c.fillStyle = '#9c968b';
      c.fillRect(0, 0, N, N);
      blobs(c, r, 2600, ['#8f897f', '#c4beb2', '#b3aca0', '#7c776e', '#d2ccc0'], 2.5, 6, 1.6);
    },
  },
  // 40 × 20 cm pavers laid like bricks.
  paving: {
    size: [0.8, 0.8], rough: 0.85, bump: 1,
    draw(c, r) {
      c.fillStyle = '#a39f96';
      c.fillRect(0, 0, N, N);
      const tones = ['#d8c9a6', '#cdbb95', '#b79f8c', '#a48a7c', '#e0d3b4', '#c4ae90'];
      const w = N / 2;
      const h = N / 4;
      for (let row = 0; row < 4; row++) for (let col = -1; col < 2; col++) {
        c.fillStyle = tones[Math.floor(r() * tones.length)];
        c.fillRect(col * w + (row % 2) * (w / 2) + 2, row * h + 2, w - 4, h - 4);
      }
      blobs(c, r, 900, ['#8f8b83', '#f0ede6'], 0.5, 1.4, 0.15);
    },
  },
  // White decorative stones.
  pebble: {
    size: [0.6, 0.6], rough: 0.8, bump: 4,
    draw(c, r) {
      c.fillStyle = '#a9a9a3';
      c.fillRect(0, 0, N, N);
      blobs(c, r, 900, ['#f4f4f0', '#e6e6e1', '#ffffff', '#d8d8d2'], 9, 20, 2);
    },
  },
  // Wood-look porcelain planks, 120 × 20 cm, laid horizontally.
  cladding: {
    size: [2.4, 0.8], rough: 0.55, bump: 0,
    draw(c, r) {
      const tones = ['#7d5a40', '#8a6447', '#74533b', '#93694a', '#84603f'];
      const h = N / 4;
      for (let row = 0; row < 4; row++) {
        const shift = (row % 2) * (N / 4) + r() * 30;
        for (let col = -1; col < 2; col++) {
          c.fillStyle = tones[Math.floor(r() * tones.length)];
          c.fillRect(col * (N / 2) + shift, row * h, N / 2, h);
        }
        for (let i = 0; i < 40; i++) {
          const y = row * h + 2 + r() * (h - 4);
          c.globalAlpha = 0.06 + r() * 0.12;
          line(c, 0, y, N, y + (r() - 0.5) * 6, r() > 0.35 ? '#4d301c' : '#c2936a', 0.6 + r() * 1.4);
        }
        c.globalAlpha = 1;
        line(c, 0, row * h, N, row * h, '#b99878', 1.5);
        for (let col = -1; col < 2; col++) line(c, col * (N / 2) + shift, row * h, col * (N / 2) + shift, (row + 1) * h, '#b99878', 1.5);
      }
    },
  },
  // Long, thin facing bricks in sandy tones.
  brick: {
    size: [0.96, 0.32], rough: 0.92, bump: 1.2,
    draw(c, r) {
      c.fillStyle = '#d2c9b8';
      c.fillRect(0, 0, N, N);
      const tones = ['#b39a7c', '#a88f72', '#bda588', '#9d866b', '#c2ab8f', '#ad9478'];
      const w = N / 4;
      const h = N / 4;
      for (let row = 0; row < 4; row++) for (let col = -1; col < 5; col++) {
        c.fillStyle = tones[Math.floor(r() * tones.length)];
        c.fillRect(col * w + (row % 2) * (w / 2) + 2, row * h + 5, w - 4, h - 10);
      }
      blobs(c, r, 1200, ['#8d775c', '#d6c6ae'], 0.6, 1.8, 0.2);
    },
  },
  asphalt: {
    size: [2, 2], rough: 0.95, bump: 1.5,
    draw(c, r) {
      c.fillStyle = '#45474b';
      c.fillRect(0, 0, N, N);
      blobs(c, r, 40, ['#3a3c40', '#505256'], 40, 110, 0.12);
      blobs(c, r, 4500, ['#5c5e62', '#303236', '#6d6f73'], 0.6, 1.7, 0.6);
    },
  },
};

// ---------- wear and dirt ----------

const WX_NOISE = `
varying vec3 wxPos;
float wxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wxNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wxHash(i), wxHash(i + vec3(1, 0, 0)), f.x), mix(wxHash(i + vec3(0, 1, 0)), wxHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wxHash(i + vec3(0, 0, 1)), wxHash(i + vec3(1, 0, 1)), f.x), mix(wxHash(i + vec3(0, 1, 1)), wxHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wxFbm(vec3 p) { return 0.5 * wxNoise(p) + 0.25 * wxNoise(p * 2.03) + 0.125 * wxNoise(p * 4.01) + 0.125 * wxNoise(p * 8.1); }
`;
// Walls: splashed dirt near the ground, rain streaks running down from the top, faint blotches.
const WX_WALL = `{
  float blot = wxFbm(wxPos * 0.7);
  float splash = smoothstep(0.45, 0.0, wxPos.y) * (0.45 + 0.55 * wxNoise(vec3(wxPos.x * 4.0, 0.0, wxPos.z * 4.0)));
  float run = wxNoise(vec3((wxPos.x + wxPos.z) * 9.0, wxPos.y * 0.5, 3.0));
  float streak = smoothstep(0.62, 0.9, run) * smoothstep(1.2, 3.0, wxPos.y);
  float dirt = clamp((splash * 0.5 + streak * 0.35 + (blot - 0.5) * 0.25) * AMT, 0.0, 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.44), dirt);
}`;
// Floors: broad stains and fine grime.
const WX_FLOOR = `{
  float blot = wxFbm(vec3(wxPos.x * 0.6, 0.0, wxPos.z * 0.6));
  float fine = wxFbm(vec3(wxPos.x * 5.0, 1.0, wxPos.z * 5.0));
  float dirt = clamp((smoothstep(0.45, 0.8, blot) * 0.5 + (fine - 0.5) * 0.3) * AMT, 0.0, 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.56, 0.5), dirt);
}`;

/** Adds wear to a material: dirt in its colour and uneven shine, laid out in world space so it never repeats. */
export function weather<T extends THREE.MeshStandardMaterial>(m: T, kind: 'wall' | 'floor', amount: number): T {
  const amt = amount.toFixed(2);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 wxPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nwxPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WX_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${kind === 'wall' ? WX_WALL : WX_FLOOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (wxFbm(wxPos * 1.3) - 0.5) * 0.35 * AMT, 0.05, 1.0);')
      .replace(/AMT/g, amt);
  };
  m.customProgramCacheKey = () => `wx-${kind}-${amt}`;
  return m;
}

const WEAR: Record<Ground, number> = {
  tile: 0.3, wood: 0.7, concrete: 1, grass: 0.5, paving: 1, gravel: 0.5, asphalt: 1, pebble: 0.3, cladding: 0.7, brick: 0.9,
};

const painted = new Map<Ground, THREE.CanvasTexture>();

function texture(kind: Ground) {
  let t = painted.get(kind);
  if (!t) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    SPECS[kind].draw(canvas.getContext('2d')!, rng(kind.length * 7919 + kind.charCodeAt(0)));
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    painted.set(kind, t);
  }
  return t;
}

/**
 * The material for a floor between two plan corners (metres). The pattern is laid out in
 * world coordinates, so tiles line up from one room to the next.
 */
export function surfaceMaterial(kind: Ground, a: { x: number; z: number }, b: { x: number; z: number }) {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: FLAT[kind], roughness: 0.9 });
  const spec = SPECS[kind];
  const map = texture(kind).clone();
  map.repeat.set((b.x - a.x) / spec.size[0], (b.z - a.z) / spec.size[1]);
  map.offset.set(a.x / spec.size[0], -b.z / spec.size[1]);
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map, roughness: spec.rough });
  if (spec.bump) {
    m.bumpMap = map;
    m.bumpScale = spec.bump;
  }
  return weather(m, 'floor', WEAR[kind]);
}

/** The material for a wall finish on a panel `length` metres long and `height` metres tall. */
export function panelMaterial(kind: Ground, length: number, height: number) {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: FLAT[kind], roughness: 0.9 });
  const spec = SPECS[kind];
  const map = texture(kind).clone();
  map.repeat.set(length / spec.size[0], height / spec.size[1]);
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map, roughness: spec.rough });
  if (spec.bump) {
    m.bumpMap = map;
    m.bumpScale = spec.bump;
  }
  return weather(m, 'wall', WEAR[kind]);
}
