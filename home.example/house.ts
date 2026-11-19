// The 3D floor plan on the Home tab (export `null` instead to hide it).
// A sample one-floor house: two bedrooms, a bathroom, an open kitchen and living room, a carport
// and a front garden. Units are centimetres (scale 0.01 → metres); x grows east, y grows south.
// Trace your own from a floor plan image: read the corners in pixels and set `scale` to
// metres per pixel (a wall you know the length of, divided by its length in pixels).
import type { HousePlan } from '../web/src/home/types';

const house: HousePlan | null = {
  scale: 0.01,
  origin: { x: 0, y: 0 },
  wallHeight: 2.7,
  doorHeight: 2.1,
  zones: [
    { id: 'living', label: 'Living room', rect: [600, 450, 1200, 900], surface: 'wood', aliases: ['living', 'living room', 'lounge', 'tv'] },
    { id: 'kitchen', label: 'Kitchen', rect: [0, 450, 600, 900], surface: 'tile', aliases: ['kitchen', 'dining', 'dining room'] },
    { id: 'master', label: 'Main bedroom', rect: [0, 0, 450, 450], surface: 'wood', bedroom: true, aliases: ['main bedroom', 'master', 'master bedroom', 'bedroom'] },
    { id: 'bath', label: 'Bathroom', rect: [450, 0, 700, 450], surface: 'tile', aliases: ['bathroom', 'bath', 'wc'] },
    { id: 'bedroom2', label: 'Bedroom 2', rect: [700, 0, 1200, 450], surface: 'wood', bedroom: true, aliases: ['bedroom 2', 'kids room', 'guest room', 'office'] },
    { id: 'carport', label: 'Carport', rect: [1210, 300, 1490, 1000], surface: 'concrete', outdoor: true, aliases: ['carport', 'garage', 'driveway'] },
    { id: 'garden', label: 'Garden', rect: [-280, 910, 1200, 1290], surface: 'grass', outdoor: true, aliases: ['garden', 'front yard', 'yard', 'porch'] },
    { id: 'roof', label: 'Roof', rect: [100, 100, 1100, 800], surface: 'tile', pinsOnly: true, pinHeight: 2.7 + 1.2, aliases: ['roof'] },
  ],
  exteriorWalls: [
    // north, with two bedroom windows
    [0, 0, 100, 0], [350, 0, 800, 0], [1050, 0, 1200, 0],
    // west and east
    [0, 0, 0, 900], [1200, 0, 1200, 900],
    // south (street side): kitchen window, front door, living room window
    [0, 900, 300, 900], [550, 900, 800, 900], [900, 900, 950, 900], [1150, 900, 1200, 900],
  ],
  interiorWalls: [
    [0, 450, 150, 450], [230, 450, 600, 450], [670, 450, 850, 450], [930, 450, 1200, 450],
    [450, 0, 450, 450], [700, 0, 700, 450],
  ],
  doors: [
    [800, 900, 900, 900], // front door
    [150, 450, 230, 450], // main bedroom
    [600, 450, 670, 450], // bathroom
    [850, 450, 930, 450], // bedroom 2
  ],
  windows: [[100, 0, 350, 0], [800, 0, 1050, 0], [300, 900, 550, 900], [950, 900, 1150, 900]],
  furniture: [
    { kind: 'bed', rect: [90, 70, 300, 290], head: 'n' },
    { kind: 'wardrobe', rect: [340, 20, 440, 260] },
    { kind: 'bed', rect: [880, 60, 1040, 260], head: 'n' },
    { kind: 'wardrobe', rect: [1110, 120, 1190, 420] },
    { kind: 'toilet', rect: [470, 30, 520, 80] },
    { kind: 'counter', rect: [10, 470, 70, 880] },
    { kind: 'island', rect: [200, 600, 260, 780] },
    { kind: 'table', rect: [360, 620, 540, 760] },
    { kind: 'sofa', rect: [720, 790, 1020, 880], head: 's' },
    { kind: 'tv', rect: [1192, 560, 1192, 780], head: 'e' },
    { kind: 'console', rect: [1150, 550, 1192, 790], head: 'e' },
    { kind: 'plant', rect: [620, 470, 680, 530] },
    { kind: 'door', rect: [800, 900, 900, 900], head: 'n' },
    { kind: 'car', rect: [1255, 360, 1445, 800], head: 's' },
    { kind: 'tree', rect: [-230, 960, -30, 1160] },
    { kind: 'shrub', rect: [320, 920, 370, 970] }, { kind: 'shrub', rect: [400, 925, 450, 975] }, { kind: 'flower', rect: [470, 920, 540, 990] },
    { kind: 'shrub', rect: [960, 920, 1010, 970] }, { kind: 'flower', rect: [1040, 920, 1110, 990] },
    { kind: 'stone', rect: [810, 905, 890, 1295] },
  ],
  cladding: [{ seg: [950, 900, 1150, 900], side: 's', kind: 'cladding', y1: 1.35 }, { seg: [900, 900, 950, 900], side: 's', kind: 'cladding' }],
  canopy: [[1205, 300, 1495, 1000]],
  lot: [-300, -150, 1500, 1500],
  sidewalk: [-300, 1300, 1500, 1500],
};
export default house;
