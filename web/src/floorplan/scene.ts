// Builds the 3D model of the house from the configured plan (plan.ts). No React here.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  CANOPY, CENTER, CLADDING, DOORS, DOOR_HEIGHT, EXTERIOR_WALLS, EXTRA_FLOORS, FLOORS, FURNITURE, GLASS, INTERIOR_WALLS, WINDOWS, LOT, SIDEWALK, WALL_HEIGHT,
  toM, type Furniture, type Rect, type Seg,
} from './plan';
import { panelMaterial, rng, surfaceMaterial, weather, type Ground } from './textures';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

const M = {
  wall: weather(mat(0xf6f5f1, { roughness: 0.95 }), 'wall', 0.3),
  cap: mat(0x3b3d41, { roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xa9c6d6, transparent: true, opacity: 0.3, roughness: 0.05, envMapIntensity: 1.6 }),
  frame: mat(0x26282b, { roughness: 0.45, metalness: 0.5 }), // black aluminium
  ledge: mat(0xd8d5ce, { roughness: 0.6 }),
  soil: mat(0x6b5a48, { roughness: 1 }),
  plant2: mat(0x5a8a45),
  lime: mat(0x9dbb3c),
  lime2: mat(0xb9cf4a),
  yellow: mat(0xd8c63a),
  deep: mat(0x2f6a34),
  orange: mat(0xe2622b, { roughness: 0.6 }),
  red: mat(0xc8324a, { roughness: 0.6 }),
  burgundy: mat(0x7a2438),
  olive: mat(0x6f9a2e),
  olive2: mat(0x8fb53a),
  trunk: mat(0xb39a76),
  plaster: weather(mat(0x8c8e92, { roughness: 0.9 }), 'wall', 0.8),
  doorWood: mat(0xcbc4b6, { roughness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xfff0c8, emissiveIntensity: 0.6, transparent: true, opacity: 0.85, roughness: 0.1 }),
  soffit: new THREE.MeshStandardMaterial({ color: 0xb98a5a, transparent: true, opacity: 0.2, roughness: 0.6, depthWrite: false }),
  white: mat(0xf1efea),
  linen: mat(0xe7e2d8),
  pillow: mat(0xfafafa),
  sofa: mat(0xd6ccbb, { roughness: 1 }), // beige fabric
  cushion: mat(0xe0d8ca, { roughness: 1 }),
  grey: mat(0x6f6a68, { roughness: 1 }),
  greyCushion: mat(0x7b7674, { roughness: 1 }),
  gold: mat(0xc9a961, { roughness: 0.35, metalness: 0.8 }),
  sage: mat(0xa9bfa6, { roughness: 1 }),
  wine: mat(0x5a1f2e, { roughness: 0.5 }),
  chair: mat(0xd9d3c8, { roughness: 1 }),
  chairIn: mat(0xd9d3c8, { roughness: 1, side: THREE.BackSide }),
  leg: mat(0xbfb39d, { roughness: 0.6 }),
  screen: mat(0x0b0c0e, { roughness: 0.12, metalness: 0.4 }),
  mirror: mat(0xe6ebee, { roughness: 0.03, metalness: 1 }),
  counter: mat(0xd9d6cf),
  wardrobe: mat(0xcbbfae),
  dark: mat(0x3d4045),
  plant: mat(0x3f6e37),
  pot: mat(0xb9a58d),
  carBlue: mat(0x4f7391, { roughness: 0.35, metalness: 0.25 }), // Fjord Blue
  tail: mat(0xb3261e),
  rim: mat(0xb9bcc0, { roughness: 0.4, metalness: 0.5 }),
  carGlass: mat(0x39444f, { roughness: 0.2 }),
};

function rectBox(r: Rect, y0: number, y1: number, material: THREE.Material | THREE.Material[], inset = 0) {
  const a = toM(r[0], r[1]);
  const b = toM(r[2], r[3]);
  const w = Math.max(0.01, b.x - a.x - inset * 2);
  const d = Math.max(0.01, b.z - a.z - inset * 2);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), material);
  mesh.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2);
  return mesh;
}

/** A box along a wall segment, extended by half the thickness so corners close. */
function segBox(s: Seg, thickness: number, y0: number, y1: number, material: THREE.Material | THREE.Material[]) {
  const a = toM(s[0], s[1]);
  const b = toM(s[2], s[3]);
  const len = Math.hypot(b.x - a.x, b.z - a.z) + thickness;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, thickness), material);
  mesh.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2);
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  return mesh;
}

// BoxGeometry face order: +x, -x, +y (top), -y, +z, -z.
const WALL_MATS = [M.wall, M.wall, M.cap, M.wall, M.wall, M.wall];

/**
 * A Volvo XC40 Recharge at real size (4.44 × 1.86 × 1.65 m), nose towards +z.
 * The body and the glasshouse are side profiles extruded across the car's width.
 */
function xc40(L: number, W: number): THREE.Group {
  const car = new THREE.Group();
  car.name = 'Volvo XC40';
  const k = L / 4.44; // profile points below are in metres for the real car
  /** Extrudes a side profile [distance from centre towards the nose, height] across `width`. */
  const profile = (pts: [number, number][], width: number, m: THREE.Material) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * k, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    car.add(mesh);
    return mesh;
  };
  const box = (bw: number, bh: number, bl: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl * k), m);
    mesh.position.set(x, y, z * k);
    car.add(mesh);
    return mesh;
  };

  // Black sill and bumper cladding, then the painted body with the rising belt line at the rear door.
  profile([[-2.2, 0.22], [2.2, 0.22], [2.22, 0.5], [-2.22, 0.5]], W, M.dark);
  profile([[-2.22, 0.42], [2.22, 0.42], [2.22, 0.8], [2.14, 0.97], [1.2, 1.07], [-0.95, 1.1], [-1.75, 1.24], [-2.18, 1.24], [-2.22, 0.9]], W * 0.995, M.carBlue);
  // Glasshouse: raked windscreen, flat roof, upright tailgate glass.
  profile([[1.2, 1.07], [0.42, 1.58], [-1.7, 1.58], [-2.12, 1.24], [-1.75, 1.24], [-0.95, 1.1]], W * 0.9, M.carGlass);
  // Body-colour pillars: A-pillars at the windscreen and the thick, kicked-up C-pillar.
  profile([[-1.3, 1.16], [-1.75, 1.24], [-2.12, 1.24], [-1.72, 1.58], [-1.5, 1.58]], W * 0.91, M.carBlue);
  // Black roof with a small spoiler (the Recharge's two-tone look).
  profile([[0.45, 1.58], [0.3, 1.64], [-1.6, 1.65], [-1.95, 1.6], [-1.7, 1.56]], W * 0.9, M.dark);

  // Front: closed, body-colour panel instead of a grille; slim headlights; lower intake.
  box(W * 0.5, 0.2, 0.03, 0, 0.78, 2.21, M.carBlue);
  box(W * 0.6, 0.12, 0.04, 0, 0.5, 2.21, M.dark);
  for (const sx of [-1, 1]) {
    box(W * 0.2, 0.07, 0.06, sx * W * 0.36, 0.86, 2.18, M.pillow); // headlight
    box(0.05, 0.42, 0.05, sx * W * 0.455, 1.2, -2.17, M.tail); // tall tail lamp up the pillar
    box(W * 0.12, 0.08, 0.05, sx * W * 0.4, 1.02, -2.2, M.tail);
    box(0.12, 0.08, 0.16, sx * (W / 2 + 0.05), 1.12, 0.95, M.dark); // mirror
    for (const z of [1.35, -1.35]) { // 2.70 m wheelbase
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 28), M.dark);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 28), M.dark);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.02, 20), M.rim);
      arch.position.set(sx * (W / 2 - 0.015), 0.4, z * k);
      tyre.position.set(sx * (W / 2 - 0.12), 0.36, z * k);
      rim.position.set(sx * (W / 2 + 0.005), 0.36, z * k);
      for (const c of [arch, tyre, rim]) { c.rotation.z = Math.PI / 2; car.add(c); }
    }
  }
  return car;
}

function rbox(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0.04) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** The canvas of the living room painting: white flowers and gold streaks on grey. */
function paintingMaterial() {
  if (typeof document === 'undefined') return mat(0xcfcbc6);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 224;
  const x = c.getContext('2d')!;
  const rand = rng(77);
  x.fillStyle = '#c9c6c2';
  x.fillRect(0, 0, 512, 224);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = rand() > 0.6 ? '#c8a85a' : rand() > 0.5 ? '#aeaaa6' : '#dedbd7';
    x.globalAlpha = 0.5;
    x.fillRect(rand() * 512, rand() * 224, 3 + rand() * 6, 20 + rand() * 70);
  }
  x.globalAlpha = 1;
  for (const [fx, fy] of [[110, 130], [190, 80], [270, 150], [340, 70], [420, 120]]) {
    x.fillStyle = '#f6f4f0';
    for (let p = 0; p < 5; p++) {
      const t = (p / 5) * Math.PI * 2 + fx;
      x.beginPath();
      x.ellipse(fx + Math.cos(t) * 22, fy + Math.sin(t) * 22, 22, 14, t, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#8a7a4a';
    x.beginPath();
    x.arc(fx, fy, 8, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
}

/** A tub dining chair at the origin, facing +z. */
function chair(): THREE.Group {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.23, 0.12, 24), M.chair);
  seat.position.y = 0.45;
  const shell = new THREE.CylinderGeometry(0.26, 0.25, 0.42, 24, 1, true, Math.PI / 2, Math.PI);
  const back = new THREE.Mesh(shell, M.chair);
  back.position.y = 0.66;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.21, 0.42, 24, 1, true, Math.PI / 2, Math.PI), M.chairIn);
  inner.position.y = 0.66;
  g.add(seat, back, inner);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.4, 8), M.leg);
    leg.position.set(sx * 0.17, 0.2, sz * 0.17);
    g.add(leg);
  }
  return g;
}

function furniture(f: Furniture): THREE.Object3D {
  const g = new THREE.Group();
  const r = f.rect;
  const a = toM(r[0], r[1]);
  const b = toM(r[2], r[3]);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const w = b.x - a.x;
  const d = b.z - a.z;
  // Pieces placed from their "head" side: u metres across, v metres out from the head.
  const head = f.head ?? 'n';
  const ns = head === 'n' || head === 's';
  const W = ns ? w : d;
  const L = ns ? d : w;
  const part = (across: number, h: number, along: number, u: number, y: number, v: number, m: THREE.Material, rad?: number) => {
    const x = head === 'n' ? cx + u : head === 's' ? cx - u : head === 'e' ? b.x - v : a.x + v;
    const z = head === 'n' ? a.z + v : head === 's' ? b.z - v : head === 'e' ? cz + u : cz - u;
    const mesh = rbox(ns ? across : along, h, ns ? along : across, x, y, z, m, rad);
    g.add(mesh);
    return mesh;
  };
  /** A group standing on the head-side wall, looking into the room (its +z). */
  const onWall = (out: number) => {
    const o = new THREE.Group();
    o.position.set(head === 'w' ? a.x + out : head === 'e' ? b.x - out : cx, 0, head === 'n' ? a.z + out : head === 's' ? b.z - out : cz);
    o.rotation.y = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 }[head];
    g.add(o);
    return o;
  };
  /** A shrub: a few leafy clumps of different sizes and colours. */
  const bush = (height: number, mats: THREE.Material[]) => {
    const rad = w / 2;
    const rand = rng(r[0] * 31 + r[1]);
    for (let i = 0; i < 6; i++) {
      const size = rad * (i ? 0.45 + rand() * 0.3 : 0.8);
      const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 2), mats[i % mats.length]);
      clump.position.set(cx + (i ? (rand() - 0.5) * rad * 1.3 : 0), (size * 0.75 + (i ? rand() * rad * 0.7 : 0)) * height, cz + (i ? (rand() - 0.5) * rad * 1.3 : 0));
      clump.scale.y = 0.85 * height;
      g.add(clump);
    }
  };
  switch (f.kind) {
    case 'bed': {
      g.add(rectBox(r, 0, 0.45, M.linen));
      const along = f.head === 'e' || f.head === 'w'; // pillows run north–south
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.35 : w * 0.8, 0.12, along ? d * 0.8 : 0.35), M.pillow);
      pillow.position.set(
        f.head === 'e' ? b.x - 0.3 : f.head === 'w' ? a.x + 0.3 : cx, 0.51,
        f.head === 's' ? b.z - 0.3 : f.head === 'n' || !f.head ? a.z + 0.3 : cz,
      );
      g.add(pillow);
      break;
    }
    case 'sofa': case 'recliner': {
      const grey = f.kind === 'recliner';
      const body = grey ? M.grey : M.sofa;
      const soft = grey ? M.greyCushion : M.cushion;
      part(W, 0.3, L, 0, 0.15, L / 2, body, 0.05);
      part(W, 0.5, 0.22, 0, 0.52, 0.11, body, 0.09); // backrest
      const arm = 0.16;
      for (const sx of [-1, 1]) part(arm, 0.34, L, sx * (W / 2 - arm / 2), 0.44, L / 2, body, 0.07);
      const inner = W - arm * 2;
      const n = Math.max(1, Math.round(inner / 0.95));
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * (inner / n);
        part(inner / n - 0.02, 0.15, L - 0.24, u, 0.37, 0.22 + (L - 0.22) / 2, soft, 0.06);
        part(inner / n - 0.12, 0.34, 0.14, u, 0.6, 0.29, soft, 0.07).rotation[ns ? 'x' : 'z'] = (head === 'n' || head === 'e' ? -1 : 1) * 0.18 * (ns ? 1 : -1);
      }
      if (!grey) {
        part(0.42, 0.3, 0.12, -inner / 2 + 0.3, 0.6, 0.42, M.sage, 0.06);
        part(0.36, 0.3, 0.12, inner / 2 - 0.9, 0.6, 0.42, M.wine, 0.06);
      }
      break;
    }
    case 'sidetable': {
      g.add(rbox(w, 0.04, d, cx, 0.55, cz, M.dark, 0.01));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(rbox(0.04, 0.53, 0.04, cx + sx * (w / 2 - 0.03), 0.265, cz + sz * (d / 2 - 0.03), M.dark, 0.005));
      break;
    }
    case 'painting': {
      // Gold frame around a pale canvas with white flowers.
      const o = onWall(0.09);
      o.add(rbox(W, 0.72, 0.03, 0, 1.75, 0, M.gold, 0.005));
      const art = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.05, 0.67), paintingMaterial());
      art.position.set(0, 1.75, 0.017);
      o.add(art);
      break;
    }
    case 'chaise': {
      g.add(rbox(w, 0.3, d, cx, 0.15, cz, M.sofa, 0.05));
      g.add(rbox(w - 0.04, 0.15, d - 0.04, cx, 0.37, cz, M.cushion, 0.06));
      break;
    }
    case 'table': {
      // White top on a wide pedestal, two chairs on each long side and one at each end.
      g.add(rbox(w, 0.05, d, cx, 0.75, cz, M.white, 0.02));
      const wide = w >= d;
      g.add(rbox(wide ? w * 0.45 : w * 0.5, 0.72, wide ? d * 0.5 : d * 0.45, cx, 0.36, cz, M.white, 0.06));
      const long = Math.max(w, d);
      const short = Math.min(w, d);
      const seats: [number, number, number][] = []; // along, across, turn
      for (const t of [-0.25, 0.25]) for (const side of [-1, 1]) seats.push([t * long, side * (short / 2 + 0.12), side > 0 ? Math.PI : 0]);
      for (const end of [-1, 1]) seats.push([end * (long / 2 + 0.12), 0, end > 0 ? -Math.PI / 2 : Math.PI / 2]);
      for (const [al, ac, turn] of seats) {
        const c = chair();
        c.position.set(cx + (wide ? al : ac), 0, cz + (wide ? ac : al));
        c.rotation.y = wide ? turn : turn + Math.PI / 2;
        g.add(c);
      }
      break;
    }
    case 'tv': {
      const o = onWall(0.1);
      const tv = rbox(W, W * 0.565, 0.04, 0, 1.4, 0, M.screen, 0.01);
      o.add(tv);
      break;
    }
    case 'console': {
      part(W, 0.5, L, 0, 0.25, L / 2, M.white, 0.02);
      part(W - 0.14, 0.32, L, 0, 0.27, L / 2 + 0.012, M.wine, 0.01);
      break;
    }
    case 'mirror': {
      // An organic, pebble-shaped mirror.
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 14; i++) {
        const t = (i / 14) * Math.PI * 2;
        pts.push(new THREE.Vector2(Math.cos(t) * (W / 2) * (1 + 0.1 * Math.sin(3 * t + 1)), Math.sin(t) * 0.38 * (1 + 0.2 * Math.cos(2 * t + 0.6))));
      }
      const o = onWall(0.06);
      const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(new THREE.SplineCurve([...pts, pts[0]]).getPoints(80)), { depth: 0.02, bevelEnabled: false }), M.mirror);
      glass.position.y = 1.65;
      o.add(glass);
      break;
    }
    case 'ac': {
      // Round ceiling cassette: white body, dark air slot, white centre.
      const y = WALL_HEIGHT - 0.05;
      const rad = w / 2;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.1, 48), M.white);
      body.position.set(cx, y, cz);
      const slot = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.82, rad * 0.82, 0.02, 48), M.dark);
      slot.position.set(cx, y - 0.055, cz);
      const centre = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.7, rad * 0.7, 0.03, 48), M.white);
      centre.position.set(cx, y - 0.065, cz);
      g.add(body, slot, centre);
      break;
    }
    case 'round': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.38, 32), M.white);
      c.position.set(cx, 0.19, cz);
      g.add(c);
      break;
    }
    case 'counter': case 'island': g.add(rectBox(r, 0, 0.9, M.counter)); break;
    case 'wardrobe': g.add(rectBox(r, 0, 2.1, M.wardrobe)); break;
    case 'toilet': g.add(rectBox(r, 0, 0.42, M.white)); break;
    case 'column': g.add(rectBox(r, 0, WALL_HEIGHT, M.dark)); break;
    case 'planter': g.add(rectBox(r, 0, 0.3, M.pot)); break;
    case 'stone': g.add(rectBox(r, 0.03, 0.06, M.counter)); break;
    case 'plant': bush(0.85, [M.plant, M.plant2]); break;
    case 'croton': bush(0.8, [M.yellow, M.deep, M.lime, M.yellow, M.orange]); break;
    case 'shrub': bush(0.6, [M.lime, M.lime2]); break;
    case 'flower': {
      bush(1, [M.deep, M.plant2, M.plant]);
      const rand = rng(r[0] * 17 + r[1]);
      for (let i = 0; i < 6; i++) {
        const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 1), i % 2 ? M.orange : M.red);
        bloom.position.set(cx + (rand() - 0.5) * w * 0.8, w * 0.75 + rand() * w * 0.5, cz + (rand() - 0.5) * w * 0.8);
        g.add(bloom);
      }
      break;
    }
    case 'conifer': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w / 2, 0.95, 14), M.lime);
      cone.position.set(cx, 0.5, cz);
      g.add(cone);
      break;
    }
    case 'cordyline': {
      // Long red leaves fanning out from the stem.
      const rand = rng(r[0] + r[1]);
      for (let i = 0; i < 14; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.75, 5), i % 3 ? M.burgundy : M.red);
        const turn = (i / 14) * Math.PI * 2;
        const lean = 0.25 + rand() * 0.55;
        leaf.geometry.translate(0, 0.375, 0);
        leaf.position.set(cx, 0.35 + rand() * 0.5, cz);
        leaf.rotation.set(Math.cos(turn) * lean, 0, Math.sin(turn) * lean);
        g.add(leaf);
      }
      break;
    }
    case 'tree': {
      // Black olive (Bucida): slim pale trunk, foliage in wide flat tiers, 2.5 m tall.
      const H = 2.5;
      const rad = w / 2;
      const rand = rng(r[0] * 13 + r[1]);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, H * 0.9, 8), M.trunk);
      trunk.position.set(cx, H * 0.45, cz);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 28), surfaceMaterial('pebble', { x: 0, z: 0 }, { x: 0.9, z: 0.9 }));
      ring.position.set(cx, 0.05, cz);
      const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20), M.soil);
      soil.position.set(cx, 0.055, cz);
      g.add(trunk, ring, soil);
      for (let tier = 0; tier < 5; tier++) {
        const y = 0.95 + tier * 0.33;
        const reach = rad * (1 - tier * 0.16);
        const n = 9 - tier;
        for (let i = 0; i < n; i++) {
          const turn = (i / n) * Math.PI * 2 + tier;
          const out = i === 0 ? 0 : reach * (0.35 + rand() * 0.4);
          const size = reach * (0.3 + rand() * 0.16);
          const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 2), (i + tier) % 3 ? M.olive : M.olive2);
          clump.position.set(cx + Math.cos(turn) * out, Math.min(y + (rand() - 0.5) * 0.12, H - size * 0.5), cz + Math.sin(turn) * out);
          clump.scale.y = 0.5;
          g.add(clump);
        }
      }
      break;
    }
    case 'bollard': {
      g.add(rbox(0.12, 0.55, 0.12, cx, 0.3, cz, M.frame, 0.01));
      g.add(rbox(0.1, 0.13, 0.1, cx, 0.64, cz, M.lamp, 0.01));
      g.add(rbox(0.13, 0.03, 0.13, cx, 0.72, cz, M.frame, 0.005));
      break;
    }
    case 'pebbles': g.add(rectBox(r, 0.03, 0.07, surfaceMaterial('pebble', a, b))); break;
    case 'door': {
      // Pale wood-grain door with a long black pull handle.
      const o = onWall(0);
      o.add(rbox(W - 0.04, DOOR_HEIGHT - 0.04, 0.05, 0, DOOR_HEIGHT / 2 + 0.02, 0, M.doorWood, 0.005));
      o.add(rbox(0.025, 1.4, 0.03, -W / 2 + 0.2, 1.15, 0.05, M.frame, 0.01));
      break;
    }
    case 'gate': {
      // Black louvred gate.
      const o = onWall(0);
      o.add(rbox(W - 0.04, DOOR_HEIGHT - 0.04, 0.04, 0, DOOR_HEIGHT / 2 + 0.02, 0, M.frame, 0.005));
      for (let i = 0; i < 16; i++) o.add(rbox(W - 0.14, 0.03, 0.06, 0, 0.2 + i * 0.115, 0, M.dark, 0.005));
      break;
    }
    case 'car': {
      g.add(xc40(Math.max(w, d), Math.min(w, d)));
      g.children[0].position.set(cx, 0, cz);
      g.children[0].rotation.y = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }[f.head ?? 's'];
      break;
    }
  }
  return g;
}

/** The house as a three.js group (metres, y up): walls, floors, furniture. Also used for the .glb export. */
export function buildHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = 'House';

  const floor = (rect: Rect, kind: Ground, y0: number, y1: number, name: string) => {
    const m = rectBox(rect, y0, y1, surfaceMaterial(kind, toM(rect[0], rect[1]), toM(rect[2], rect[3])));
    m.name = name;
    m.receiveShadow = true;
    house.add(m);
    return m;
  };

  // The lot as a thick slab, like the base of a scale model; street and sidewalk at the front.
  const pad = 400;
  const lot: Rect = [LOT[0] - pad, LOT[1] - pad, LOT[2] + pad, LOT[3] + pad];
  const grass = surfaceMaterial('grass', toM(lot[0], lot[1]), toM(lot[2], lot[3]));
  const ground = rectBox(lot, -0.5, -0.02, [M.soil, M.soil, grass, M.soil, M.soil, M.soil]);
  ground.name = 'Ground';
  ground.receiveShadow = true;
  house.add(ground);
  if (SIDEWALK) {
    floor([lot[0], SIDEWALK[3], lot[2], lot[3]], 'concrete', -0.02, -0.01, 'Street');
    floor(SIDEWALK, 'paving', -0.02, 0.0, 'Sidewalk');
  }

  for (const z of FLOORS) floor(z.rect, z.surface, 0, 0.03, `Floor ${z.label}`);
  for (const e of EXTRA_FLOORS) floor(e.rect, e.surface, 0, 0.03, 'Floor');

  for (const [list, t] of [[EXTERIOR_WALLS, 0.15], [INTERIOR_WALLS, 0.1]] as const) {
    for (const s of list) {
      const w = segBox(s, t, 0, WALL_HEIGHT, WALL_MATS);
      w.name = t > 0.12 ? 'Exterior wall' : 'Interior wall';
      w.castShadow = true;
      w.receiveShadow = true;
      house.add(w);
    }
  }
  for (const d of DOORS) {
    const l = segBox(d, 0.1, DOOR_HEIGHT, WALL_HEIGHT, WALL_MATS);
    l.name = 'Door lintel';
    l.castShadow = true;
    l.receiveShadow = true;
    house.add(l);
  }

  /** Black frame around a glazed opening: rails top and bottom, a post about every metre. */
  const frame = (s: Seg, y0: number, y1: number, name: string) => {
    const a = toM(s[0], s[1]);
    const b = toM(s[2], s[3]);
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 1.1));
    const parts: THREE.Mesh[] = [segBox(s, 0.07, y0, y0 + 0.06, M.frame), segBox(s, 0.07, y1 - 0.06, y1, M.frame)];
    for (let i = 0; i <= n; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, y1 - y0, 0.07), M.frame);
      post.position.set(a.x + ((b.x - a.x) * i) / n, (y0 + y1) / 2, a.z + ((b.z - a.z) * i) / n);
      post.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      parts.push(post);
    }
    for (const p of parts) { p.name = name; p.castShadow = true; house.add(p); }
  };

  const top = DOOR_HEIGHT + 0.2;
  for (const g of GLASS) {
    const glass = segBox(g, 0.02, 0, top, M.glass);
    glass.name = 'Glass door';
    const header = segBox(g, 0.15, top, WALL_HEIGHT, WALL_MATS);
    header.name = 'Door lintel';
    header.castShadow = true;
    house.add(glass, header);
    frame(g, 0.03, top, 'Glass door frame');
  }
  for (const w of WINDOWS) {
    const sill = segBox(w, 0.15, 0, WALL_HEIGHT / 2, WALL_MATS);
    sill.name = 'Window wall';
    sill.castShadow = true;
    sill.receiveShadow = true;
    const ledge = segBox(w, 0.22, WALL_HEIGHT / 2, WALL_HEIGHT / 2 + 0.04, M.ledge);
    ledge.name = 'Window sill';
    ledge.castShadow = true;
    const pane = segBox(w, 0.02, WALL_HEIGHT / 2, WALL_HEIGHT, M.glass);
    pane.name = 'Window';
    house.add(sill, ledge, pane);
    frame(w, WALL_HEIGHT / 2 + 0.04, WALL_HEIGHT, 'Window frame');
  }

  // Façade finishes: thin panels on the outer face of the walls.
  for (const c of CLADDING) {
    const a = toM(c.seg[0], c.seg[1]);
    const b = toM(c.seg[2], c.seg[3]);
    const y0 = c.y0 ?? 0;
    const y1 = c.y1 ?? WALL_HEIGHT;
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.2;
    const finish = c.kind === 'grey' ? M.plaster : panelMaterial(c.kind, len, y1 - y0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, 0.024), finish);
    const out = 0.075 + 0.013;
    panel.position.set(
      (a.x + b.x) / 2 + (c.side === 'e' ? out : c.side === 'w' ? -out : 0), (y0 + y1) / 2,
      (a.z + b.z) / 2 + (c.side === 's' ? out : c.side === 'n' ? -out : 0),
    );
    panel.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    panel.name = 'Facade';
    panel.castShadow = true;
    panel.receiveShadow = true;
    house.add(panel);
  }

  // Canopy: a black frame with a see-through wooden soffit.
  for (const c of CANOPY) {
    const edges: Seg[] = [[c[0], c[1], c[2], c[1]], [c[0], c[3], c[2], c[3]], [c[0], c[1], c[0], c[3]], [c[2], c[1], c[2], c[3]]];
    for (const e of edges) {
      const beam = segBox(e, 0.12, 2.62, 2.86, M.frame);
      beam.name = 'Canopy';
      beam.castShadow = true;
      house.add(beam);
    }
    const soffit = rectBox(c, 2.66, 2.7, M.soffit);
    soffit.name = 'Canopy';
    house.add(soffit);
  }

  for (const f of FURNITURE) {
    const o = furniture(f);
    o.name = f.kind[0].toUpperCase() + f.kind.slice(1);
    o.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = f.kind !== 'ac'; m.receiveShadow = true; } });
    house.add(o);
  }
  return house;
}


// ---------- detailed car model ----------

/** Places a loaded car model on its parking rectangle, at the rectangle's real length. */
export function fitCar(model: THREE.Object3D, f: Furniture): THREE.Group {
  // The file carries its own paint (set per part when the model was prepared).
  model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  const a = toM(f.rect[0], f.rect[1]);
  const b = toM(f.rect[2], f.rect[3]);
  const length = Math.max(b.x - a.x, b.z - a.z);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(length / Math.max(size.x, size.z)); // the model's nose points to +z
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const car = new THREE.Group();
  car.name = 'Volvo XC40 Recharge';
  car.add(model);
  car.position.set((a.x + b.x) / 2, 0.03, (a.z + b.z) / 2);
  car.rotation.y = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }[f.head ?? 's'];
  return car;
}

/** Swaps the block cars in a house for the detailed model (parsed from the .glb's bytes). */
export async function upgradeCars(house: THREE.Group, glb: ArrayBuffer) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(glb, '');
  const cars = FURNITURE.filter((f) => f.kind === 'car');
  cars.forEach((f, i) => {
    const old = house.children.filter((o) => o.name === 'Car')[0];
    if (old) house.remove(old);
    house.add(fitCar(i === cars.length - 1 ? gltf.scene : gltf.scene.clone(true), f));
  });
}

// ---------- rendering ----------

/**
 * Sun shadows whose edge widens with the distance to whatever casts them: crisp where a wall
 * meets the floor, soft further away. Replaces three.js's fixed-blur filter (its PCF slot).
 */
const PCSS = `
#define PCSS_SEARCH 0.011
#define PCSS_SPREAD 0.14
#define PCSS_MIN 0.0005
vec2 pcssDisk(int i, float n, float turn) {
  float r = sqrt((float(i) + 0.5) / n);
  float t = float(i) * 2.39996323 + turn;
  return r * vec2(cos(t), sin(t));
}
float pcssShadow(sampler2D map, vec4 coord) {
  vec2 uv = coord.xy;
  float z = coord.z;
  // Slope of the receiving surface in the shadow map, so a wide filter does not shade the surface itself.
  vec3 dx = dFdx(coord.xyz);
  vec3 dy = dFdy(coord.xyz);
  float det = dx.x * dy.y - dx.y * dy.x;
  vec2 slope = abs(det) > 1e-10 ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det : vec2(0.0);
  slope = clamp(slope, vec2(-2.0), vec2(2.0));
  float turn = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  float n = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 o = pcssDisk(i, 16.0, turn) * PCSS_SEARCH;
    float d = unpackRGBAToDepth(texture2D(map, uv + o));
    if (d < z + dot(slope, o) - 0.0008) { sum += d; n += 1.0; }
  }
  if (n < 0.5) return 1.0;
  float spread = clamp((z - sum / n) * PCSS_SPREAD, PCSS_MIN, PCSS_SEARCH * 1.6);
  float lit = 0.0;
  for (int i = 0; i < 28; i++) {
    vec2 o = pcssDisk(i, 28.0, turn) * spread;
    lit += step(z + dot(slope, o) - 0.0008, unpackRGBAToDepth(texture2D(map, uv + o)));
  }
  return lit / 28.0;
}
`;
let pcssInstalled = false;
function installSoftShadows() {
  if (pcssInstalled) return;
  pcssInstalled = true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const slot = '#if defined( SHADOWMAP_TYPE_PCF )';
  if (chunk.includes('pcssShadow')) return; // already installed (e.g. this module was reloaded)
  if (!chunk.includes(slot) || !chunk.includes('#ifdef USE_SHADOWMAP')) return; // a different three.js: keep its own filter
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk
    .replace('#ifdef USE_SHADOWMAP', `#ifdef USE_SHADOWMAP\n${PCSS}`)
    .replace(slot, `${slot}\n\t\t\tshadow = pcssShadow( shadowMap, shadowCoord );\n\t\t#elif defined( SHADOWMAP_TYPE_PCF_STOCK )`);
}

/**
 * Sunlit haze: marches each view ray through the air inside the house and adds a little light
 * wherever the sun reaches, so the shade behind walls reads as shafts. Warmer when looking sunwards.
 */
const AIR = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tShadow: { value: null as THREE.Texture | null },
    shadowMatrix: { value: new THREE.Matrix4() },
    projInv: { value: new THREE.Matrix4() },
    viewInv: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    sunDir: { value: new THREE.Vector3() },
    top: { value: 3.2 },
    strength: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tShadow;
    uniform mat4 shadowMatrix;
    uniform mat4 projInv;
    uniform mat4 viewInv;
    uniform vec3 camPos;
    uniform vec3 sunDir;
    uniform float top;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 px = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;
      if (strength <= 0.0 || depth >= 1.0) { gl_FragColor = px; return; }
      vec4 view = projInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec3 world = (viewInv * vec4(view.xyz / view.w, 1.0)).xyz;
      vec3 ray = world - camPos;
      float len = length(ray);
      vec3 dir = ray / len;
      // Only the air below the wall tops counts.
      float start = camPos.y > top && dir.y < 0.0 ? (top - camPos.y) / dir.y : 0.0;
      float span = len - start;
      if (span <= 0.0) { gl_FragColor = px; return; }
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float lit = 0.0;
      for (int i = 0; i < 20; i++) {
        vec3 p = camPos + dir * (start + span * (float(i) + jitter) / 20.0);
        vec4 sc = shadowMatrix * vec4(p, 1.0);
        sc.xyz /= sc.w;
        bool inside = sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0;
        lit += inside ? step(sc.z - 0.002, unpackRGBAToDepth(texture2D(tShadow, sc.xy))) : 1.0;
      }
      float sunward = max(dot(dir, sunDir), 0.0);
      float phase = 0.55 + 1.6 * pow(sunward, 3.0);
      vec3 glow = vec3(1.0, 0.86, 0.66) * (lit / 20.0) * min(span, 12.0) * phase * strength;
      gl_FragColor = vec4(px.rgb + glow * px.a, px.a);
    }`,
};

/**
 * Light from a painted sky: blue overhead, pale at the horizon, a warm glow around the sun.
 * Used as the scene's environment, so shade is cool and sunlit faces are warm, as outdoors.
 */
function skyEnvironment(pmrem: THREE.PMREMGenerator, sun: THREE.Vector3) {
  const sky = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sun: { value: sun } },
    vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 sun;
      varying vec3 dir;
      void main() {
        vec3 v = normalize(dir);
        vec3 zenith = vec3(0.34, 0.5, 0.9) * 1.1;
        vec3 horizon = vec3(0.82, 0.89, 1.0) * 1.55;
        vec3 ground = vec3(0.38, 0.35, 0.31) * 0.8;
        vec3 c = v.y > 0.0 ? mix(horizon, zenith, pow(v.y, 0.45)) : mix(horizon * 0.7, ground, smoothstep(0.0, -0.2, v.y));
        float s = max(dot(v, sun), 0.0);
        c += vec3(1.0, 0.8, 0.58) * (pow(s, 6.0) * 0.8 + pow(s, 48.0) * 3.0) * smoothstep(-0.08, 0.02, v.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), material);
  sky.add(dome);
  const texture = pmrem.fromScene(sky, 0.02).texture;
  dome.geometry.dispose();
  material.dispose();
  return texture;
}

/** Final look, applied to the finished picture: light sharpening, split toning, contrast, vignette, grain. */
const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, texel: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec4 px = texture2D(tDiffuse, vUv);
      vec3 c = px.rgb;
      // unsharp mask
      vec3 blur = 0.25 * (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb);
      c += (c - blur) * 0.3;
      // split tone: cool shadows, warm highlights
      c *= mix(vec3(0.95, 0.99, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.85, luma(c)));
      // gentle S-curve, a touch more colour
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      c = mix(vec3(luma(c)), c, 1.1);
      // vignette and film grain
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.3;
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.02 * px.a;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), px.a);
    }`,
};

export interface HouseScene {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render(): void;
  resize(w: number, h: number): void;
  /** Lights that glow where a light device is on. */
  setGlows(points: { x: number; y: number; z: number }[]): void;
  /** Screen position (CSS px within the canvas) of a scene point; null when behind the camera. */
  project(x: number, y: number, z: number): { left: number; top: number } | null;
  /** Floor point under the pointer, at height y. */
  pick(clientX: number, clientY: number, y: number): { x: number; z: number } | null;
  resetView(): void;
  dispose(): void;
}

export function createHouse(canvas: HTMLCanvasElement): HouseScene {
  const small = window.matchMedia('(max-width: 700px)').matches;
  installSoftShadows();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // the slot the soft-shadow filter is installed in
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);

  // A warm, fairly low sun, and the sky as the fill light.
  const sunFrom = new THREE.Vector3(-13, 20, 9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = skyEnvironment(pmrem, sunFrom.clone().normalize());
  scene.environment = env;
  scene.environmentIntensity = 0.75;

  const sun = new THREE.DirectionalLight(0xffdfb5, 3);
  sun.position.set(CENTER.x + sunFrom.x, sunFrom.y, CENTER.z + sunFrom.z);
  sun.target.position.set(CENTER.x, 0, CENTER.z);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(small ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  // Ambient occlusion darkens the creases where walls meet floors, as in a real model.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.4, scale: 1.5, samples: 16 });
  gtao.blendIntensity = 0.95;
  composer.addPass(gtao);
  const air = new ShaderPass(AIR);
  air.uniforms.tDepth.value = gtao.depthTexture;
  air.uniforms.sunDir.value.copy(sunFrom).normalize();
  composer.addPass(air);
  // Bright sunlit surfaces glow a little, then the picture is tone mapped and graded.
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.7, 1.1));
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE);
  composer.addPass(grade);

  const house = buildHouse();
  scene.add(house);
  // The simple car shows at once; the detailed one replaces it when its file arrives.
  let disposed = false;
  fetch('/models/xc40.glb')
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((glb) => upgradeCars(house, glb))
    .then(() => { if (!disposed) controls.dispatchEvent({ type: 'change' }); })
    .catch(() => { /* keep the simple car */ });

  const glows: THREE.PointLight[] = [];
  const glowGroup = new THREE.Group();
  scene.add(glowGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 5;
  controls.maxDistance = 50;
  controls.screenSpacePanning = false;

  const resetView = () => {
    camera.position.set(CENTER.x, 19, CENTER.z + 17);
    controls.target.set(CENTER.x, 0, CENTER.z);
    controls.update();
  };
  resetView();

  let again = 0;
  const render = () => {
    const u = air.uniforms;
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.viewInv.value.copy(camera.matrixWorld);
    u.camPos.value.copy(camera.position);
    u.shadowMatrix.value.copy(sun.shadow.matrix);
    const ready = Boolean(sun.shadow.map);
    u.tShadow.value = sun.shadow.map?.texture ?? null;
    u.strength.value = ready ? 0.007 : 0;
    composer.render();
    // The sun's shadow map only exists after the first frame; draw once more so the haze can use it.
    if (!ready && !again) again = requestAnimationFrame(() => { again = 0; render(); });
  };
  const v = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  return {
    renderer,
    camera,
    controls,
    render,
    resize(w, h) {
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      const ratio = renderer.getPixelRatio();
      grade.uniforms.texel.value.set(1 / (w * ratio), 1 / (h * ratio));
      camera.aspect = w / h;
      // Keep the whole house in view on narrow screens.
      camera.fov = w / h < 1 ? 50 : 35;
      camera.updateProjectionMatrix();
    },
    setGlows(points) {
      while (glows.length > points.length) glowGroup.remove(glows.pop()!);
      while (glows.length < points.length) {
        const l = new THREE.PointLight(0xffc96b, 9, 5.5, 1.6);
        glows.push(l);
        glowGroup.add(l);
      }
      points.forEach((p, i) => glows[i].position.set(p.x, Math.min(p.y + 0.6, WALL_HEIGHT - 0.2), p.z));
    },
    project(x, y, z) {
      v.set(x, y, z).project(camera);
      if (v.z > 1) return null;
      const { clientWidth: w, clientHeight: h } = canvas;
      return { left: ((v.x + 1) / 2) * w, top: ((1 - v.y) / 2) * h };
    },
    pick(clientX, clientY, y) {
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      plane.constant = -y;
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      return hit ? { x: hit.x, z: hit.z } : null;
    },
    resetView,
    dispose() {
      disposed = true;
      cancelAnimationFrame(again);
      controls.dispose();
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat() as THREE.MeshStandardMaterial[]) { m.map?.dispose(); m.dispose(); }
      });
      Object.values(M).forEach((m) => m.dispose());
      composer.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
