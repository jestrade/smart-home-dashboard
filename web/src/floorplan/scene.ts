// Builds the 3D model of the house from plan.ts. No React here.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  CENTER, DOORS, DOOR_HEIGHT, EXTERIOR_WALLS, EXTRA_FLOORS, FLOORS, FURNITURE, GLASS, INTERIOR_WALLS, WINDOWS, LOT, SIDEWALK, WALL_HEIGHT,
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

function furniture(f: Furniture): THREE.Object3D {
  const g = new THREE.Group();
  const r = f.rect;
  const a = toM(r[0], r[1]);
  const b = toM(r[2], r[3]);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const w = b.x - a.x;
  const d = b.z - a.z;
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
    case 'sofa': g.add(rectBox(r, 0, 0.42, M.sofa)); break;
    case 'table': {
      g.add(rectBox(r, 0.72, 0.77, M.white));
      g.add(rectBox(r, 0, 0.72, M.white, 0.3));
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
    case 'plant': {
      const rad = w / 2;
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), M.plant);
      bush.position.set(cx, rad * 0.9, cz);
      bush.scale.y = 0.9;
      g.add(bush);
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

  // Ground and sidewalk
  const pad = 400;
  const ground = rectBox([LOT[0] - pad, LOT[1] - pad, LOT[2] + pad, LOT[3] + pad], -0.06, -0.02, M.ground);
  ground.name = 'Ground';
  ground.receiveShadow = true;
  house.add(ground);
  const walk = rectBox(SIDEWALK, -0.02, 0.0, mat(SURFACE.paving));
  walk.name = 'Sidewalk';
  walk.receiveShadow = true;
  house.add(walk);

  for (const z of FLOORS) {
    const floor = rectBox(z.rect, 0, 0.03, mat(SURFACE[z.surface]));
    floor.name = `Floor ${z.label}`;
    floor.receiveShadow = true;
    house.add(floor);
  }

  for (const e of EXTRA_FLOORS) {
    const floor = rectBox(e.rect, 0, 0.03, mat(SURFACE[e.surface]));
    floor.name = 'Floor';
    floor.receiveShadow = true;
    house.add(floor);
  }

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
    house.add(l);
  }
  for (const g of GLASS) {
    const glass = segBox(g, 0.04, 0, DOOR_HEIGHT + 0.2, M.glass);
    glass.name = 'Glass door';
    house.add(glass);
  }
  for (const w of WINDOWS) {
    const sill = segBox(w, 0.15, 0, WALL_HEIGHT / 2, WALL_MATS);
    sill.name = 'Window wall';
    sill.castShadow = true;
    sill.receiveShadow = true;
    const pane = segBox(w, 0.04, WALL_HEIGHT / 2, WALL_HEIGHT, M.glass);
    pane.name = 'Window';
    house.add(sill, pane);
  }

  for (const f of FURNITURE) {
    const o = furniture(f);
    o.name = f.kind[0].toUpperCase() + f.kind.slice(1);
    o.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = true; m.receiveShadow = true; } });
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
      disposed = true;
      controls.dispose();
      scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      Object.values(M).forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
