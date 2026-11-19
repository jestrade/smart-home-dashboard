// The configured house plan (home/house.ts or home.example/house.ts) with the helpers the 3D
// scene and the pin mapping use. Plan coordinates: x east, y south, in plan units.
// house.ts sits beside home.config.ts and has no image imports, so the GLB export script can
// load it in Node. Its default export is the plan, or null for no 3D plan.
import configured from '@home/house';
import type { HousePlan, Rect } from '../home/types';

export type { Cladding, Furniture, Rect, Seg, Surface, Zone } from '../home/types';

const EMPTY: HousePlan = { scale: 1, origin: { x: 0, y: 0 }, zones: [], exteriorWalls: [], interiorWalls: [], doors: [], lot: [0, 0, 1, 1] };
/** Whether this household configured a house (the plan is hidden otherwise). */
export const HAS_HOUSE = Boolean(configured);
const h: HousePlan = configured ?? EMPTY;

export const PX = h.scale;
export const WALL_HEIGHT = h.wallHeight ?? 3;
export const DOOR_HEIGHT = h.doorHeight ?? 2.1;
export const ZONES = h.zones;
/** Zones that draw a floor (pins-only zones such as the roof do not). */
export const FLOORS = ZONES.filter((z) => !z.pinsOnly);
export const EXTRA_FLOORS = h.extraFloors ?? [];
export const EXTERIOR_WALLS = h.exteriorWalls;
export const INTERIOR_WALLS = h.interiorWalls;
export const DOORS = h.doors;
export const WINDOWS = h.windows ?? [];
export const GLASS = h.glass ?? [];
export const FURNITURE = h.furniture ?? [];
export const CLADDING = h.cladding ?? [];
export const CANOPY = h.canopy ?? [];
export const LOT: Rect = h.lot;
export const SIDEWALK: Rect | null = h.sidewalk ?? null;

/** Plan units → scene metres (x east, z south). */
export const toM = (x: number, y: number) => ({ x: (x - h.origin.x) * PX, z: (y - h.origin.y) * PX });

/** Centre of the plot without the sidewalk, so the camera orbits the house. */
export const CENTER = toM((LOT[0] + LOT[2]) / 2, (LOT[1] + (SIDEWALK?.[1] ?? LOT[3])) / 2);
