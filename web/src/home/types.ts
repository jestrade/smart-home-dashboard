// The household's own configuration: name, house plan, cars, photos. The app reads it from
// home/ (private, git-ignored) when present, else from home.example/ (the sample shipped in git).
import type { CarProfile } from '../carProfiles';

export type Seg = [x1: number, y1: number, x2: number, y2: number];
export type Rect = [x1: number, y1: number, x2: number, y2: number];

export type Surface = 'tile' | 'wood' | 'concrete' | 'grass' | 'paving' | 'gravel';
export type Side = 'n' | 's' | 'e' | 'w';

export interface Zone {
  id: string;
  label: string;
  rect: Rect;
  surface: Surface;
  /** Names a dashboard room can have to land here automatically (lower case, no accents). */
  aliases: string[];
  /** Device pins float this high above the floor (roof devices). */
  pinHeight?: number;
  /** Bedrooms take otherwise-unmatched bedroom-like rooms ("Cuarto …", "Bedroom …"), in plan order. */
  bedroom?: boolean;
  outdoor?: boolean;
  /** Only positions pins (e.g. the roof); no floor is drawn. */
  pinsOnly?: boolean;
}

export interface Furniture {
  kind: 'tree' | 'bollard' | 'croton' | 'shrub' | 'flower' | 'conifer' | 'cordyline' | 'pebbles' | 'door' | 'gate' | 'bed' | 'sofa' | 'recliner' | 'sidetable' | 'painting' | 'chaise' | 'tv' | 'console' | 'mirror' | 'ac' | 'table' | 'round' | 'counter' | 'island' | 'car' | 'column' | 'plant' | 'wardrobe' | 'toilet' | 'planter' | 'stone';
  rect: Rect;
  /** Beds: the side the pillows are on. Cars: the side the nose points to. Sofas: the side of the backrest. TV, console, mirror: the side of their wall. */
  head?: Side;
}

/** Finishes on the outside of the walls. `side` is the face that looks outwards. */
export interface Cladding {
  seg: Seg;
  side: Side;
  kind: 'cladding' | 'brick' | 'grey';
  y0?: number;
  y1?: number;
}

/**
 * A one-floor house, drawn in "plan units" (e.g. pixels of a scanned floor plan). `scale` turns
 * plan units into metres; `origin` is the plan point that becomes the scene's origin.
 */
export interface HousePlan {
  scale: number;
  origin: { x: number; y: number };
  wallHeight?: number;
  doorHeight?: number;
  zones: Zone[];
  /** Floor pieces that complete L-shaped spaces. */
  extraFloors?: { rect: Rect; surface: Surface }[];
  /** Walls, door openings excluded (doors are listed separately and get a lintel). */
  exteriorWalls: Seg[];
  interiorWalls: Seg[];
  /** Door openings: a lintel above, nothing below. */
  doors: Seg[];
  /** Windows: solid wall up to half the wall's height, glass above. */
  windows?: Seg[];
  /** Full-height glass (sliding doors). */
  glass?: Seg[];
  furniture?: Furniture[];
  cladding?: Cladding[];
  /** Flat see-through roofs (porch, carport). */
  canopy?: Rect[];
  /** The plot around the house, and the strip of it that is sidewalk (the street is drawn beyond). */
  lot: Rect;
  sidewalk?: Rect;
}

export interface HomeConfig {
  /** Shown in the header, the sign-in page and the browser tab. */
  appName: string;
  /** Static details and photos for the household's cars (see carProfiles.ts). */
  cars?: CarProfile[];
  /** Page background photos (imported images), shown blurred behind the cards. */
  backgrounds?: { light?: string; dark?: string };
}
