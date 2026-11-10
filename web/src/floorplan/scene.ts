// Builds the 3D model of the house from plan.ts. No React here.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CENTER, DOORS, DOOR_HEIGHT, EXTERIOR_WALLS, FLOORS, FURNITURE, GLASS, INTERIOR_WALLS, LOT, SIDEWALK, WALL_HEIGHT,
  toM, type Furniture, type Rect, type Seg, type Surface,
} from './plan';

const SURFACE: Record<Surface, number> = {
  tile: 0xc3c4c1, // the light grey porcelain floor
  wood: 0x9b7653,
  concrete: 0x9d9e9b,
  grass: 0x6d9a4c,
  paving: 0xdcd9d2,
  gravel: 0xb6b0a5,
};

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

const M = {
  wall: mat(0xf3f2ee),
  cap: mat(0x4a4d52),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.28, roughness: 0.1 }),
  ground: mat(0x5f8a43),
  white: mat(0xf1efea),
  linen: mat(0xe7e2d8),
  pillow: mat(0xfafafa),
  sofa: mat(0x6b625b),
  counter: mat(0xd9d6cf),
  wardrobe: mat(0xcbbfae),
  dark: mat(0x3d4045),
  plant: mat(0x3f6e37),
  pot: mat(0xb9a58d),
  carBlue: mat(0x5a7690, { roughness: 0.4 }),
  carGrey: mat(0xa3a6aa, { roughness: 0.4 }),
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

function furniture(f: Furniture): THREE.Object3D {
  const g = new THREE.Group();
  const r = f.rect;
  switch (f.kind) {
    case 'bed': {
      g.add(rectBox(r, 0, 0.45, M.linen));
      const a = toM(r[0], r[1]);
      const b = toM(r[2], r[3]);
      // Pillows along the side nearest a wall (the north side on this plan).
      const pillow = new THREE.Mesh(new THREE.BoxGeometry((b.x - a.x) * 0.8, 0.12, 0.35), M.pillow);
      pillow.position.set((a.x + b.x) / 2, 0.51, a.z + 0.3);
      g.add(pillow);
      break;
    }
    case 'sofa': g.add(rectBox(r, 0, 0.42, M.sofa)); break;
    case 'table': {
      g.add(rectBox(r, 0.72, 0.77, M.white));
      g.add(rectBox(r, 0, 0.72, M.white, 0.55));
      break;
    }
    case 'round': {
      const a = toM(r[0], r[1]);
      const b = toM(r[2], r[3]);
      const c = new THREE.Mesh(new THREE.CylinderGeometry((b.x - a.x) / 2, (b.x - a.x) / 2, 0.38, 32), M.white);
      c.position.set((a.x + b.x) / 2, 0.19, (a.z + b.z) / 2);
      g.add(c);
      break;
    }
    case 'counter': case 'island': g.add(rectBox(r, 0, 0.9, M.counter)); break;
    case 'wardrobe': g.add(rectBox(r, 0, 2.1, M.wardrobe)); break;
    case 'toilet': g.add(rectBox(r, 0, 0.42, M.white)); break;
    case 'column': g.add(rectBox(r, 0, WALL_HEIGHT, M.dark)); break;
    case 'plant': {
      const a = toM(r[0], r[1]);
      const b = toM(r[2], r[3]);
      const rad = (b.x - a.x) / 2;
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), M.plant);
      bush.position.set(a.x + rad, rad * 0.9, a.z + rad);
      bush.scale.y = 0.8;
      g.add(bush);
      break;
    }
    case 'car': {
      const first = !FURNITURE.slice(0, FURNITURE.indexOf(f)).some((x) => x.kind === 'car');
      const body = first ? M.carBlue : M.carGrey;
      g.add(rectBox(r, 0.18, 0.85, body, 0.05));
      const a = toM(r[0], r[1]);
      const b = toM(r[2], r[3]);
      const len = b.z - a.z;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry((b.x - a.x) * 0.8, 0.55, len * 0.5), M.carGlass);
      cabin.position.set((a.x + b.x) / 2, 1.12, a.z + len * 0.55);
      g.add(cabin);
      for (const [fx, fz] of [[0.1, 0.18], [0.9, 0.18], [0.1, 0.82], [0.9, 0.82]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 20), M.dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(a.x + (b.x - a.x) * fx, 0.33, a.z + len * fz);
        g.add(wheel);
      }
      break;
    }
  }
  return g;
}

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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8378, 1.5));
  const sun = new THREE.DirectionalLight(0xfff6e8, 2.4);
  sun.position.set(CENTER.x - 10, 25, CENTER.z + 14);
  sun.target.position.set(CENTER.x, 0, CENTER.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const house = new THREE.Group();
  scene.add(house);

  // Ground and sidewalk
  const pad = 40;
  const ground = rectBox([LOT[0] - pad, LOT[1] - pad, LOT[2] + pad, LOT[3] + pad], -0.06, -0.02, M.ground);
  ground.receiveShadow = true;
  house.add(ground);
  const walk = rectBox(SIDEWALK, -0.02, 0.0, mat(SURFACE.paving));
  walk.receiveShadow = true;
  house.add(walk);

  for (const z of FLOORS) {
    const floor = rectBox(z.rect, 0, 0.03, mat(SURFACE[z.surface]));
    floor.receiveShadow = true;
    house.add(floor);
  }

  for (const [list, t] of [[EXTERIOR_WALLS, 0.2], [INTERIOR_WALLS, 0.12]] as const) {
    for (const s of list) {
      const w = segBox(s, t, 0, WALL_HEIGHT, WALL_MATS);
      w.castShadow = true;
      w.receiveShadow = true;
      house.add(w);
    }
  }
  for (const d of DOORS) {
    const l = segBox(d, 0.12, DOOR_HEIGHT, WALL_HEIGHT, WALL_MATS);
    l.castShadow = true;
    house.add(l);
  }
  for (const g of GLASS) house.add(segBox(g, 0.04, 0, DOOR_HEIGHT + 0.2, M.glass));

  for (const f of FURNITURE) {
    const o = furniture(f);
    o.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = true; m.receiveShadow = true; } });
    house.add(o);
  }

  const glows: THREE.PointLight[] = [];
  const glowGroup = new THREE.Group();
  scene.add(glowGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 7;
  controls.maxDistance = 50;
  controls.screenSpacePanning = false;

  const resetView = () => {
    camera.position.set(CENTER.x, 21, CENTER.z + 19);
    controls.target.set(CENTER.x, 0, CENTER.z);
    controls.update();
  };
  resetView();

  const render = () => renderer.render(scene, camera);
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
      controls.dispose();
      scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      Object.values(M).forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
