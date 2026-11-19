// The 3D floor plan on the Home tab (export `null` instead to hide it).
//
// A sample one-floor, L-shaped house: an open kitchen, dining and living area with an enclosed
// garage at one end, and a bedroom wing with three bedrooms, a study, a bathroom and a laundry
// around a corridor. The inside corner of the L is a wooden deck and a small back yard.
//
// Units are centimetres (scale 0.01 → metres); x grows east, y grows south.
// Trace your own from a floor plan image: read the corners in pixels and set `scale` to metres
// per pixel (a wall you know the length of, divided by its length in pixels).
import type { Cladding, HousePlan, Seg } from '../web/src/home/types';

const WALL_HEIGHT = 2.7;

// Outer walls, openings left out (doors and windows are listed below).
const north: Seg[] = [[0, 0, 50, 0], [350, 0, 600, 0], [800, 0, 1050, 0], [1150, 0, 1250, 0], [1450, 0, 1500, 0]];
const west: Seg[] = [[0, 0, 0, 700]];
const east: Seg[] = [[1500, 0, 1500, 780], [1500, 920, 1500, 1300], [1500, 1450, 1500, 1600]];
const south: Seg[] = [[600, 1600, 700, 1600], [780, 1600, 920, 1600], [1030, 1600, 1500, 1600]];
// The inside corner of the L, facing the deck.
const courtSouth: Seg[] = [[0, 700, 400, 700]];
const courtWest: Seg[] = [[600, 700, 600, 780], [600, 920, 600, 1080], [600, 1220, 600, 1600]];

/** Grey render on every solid outer face. */
const render = (segs: Seg[], side: Cladding['side']): Cladding[] => segs.map((seg) => ({ seg, side, kind: 'grey' }));

const house: HousePlan | null = {
  scale: 0.01,
  origin: { x: 0, y: 0 },
  wallHeight: WALL_HEIGHT,
  doorHeight: 2.1,
  zones: [
    { id: 'garage', label: 'Garage', rect: [0, 0, 400, 700], surface: 'concrete', aliases: ['garage', 'car', 'workshop'] },
    { id: 'kitchen', label: 'Kitchen', rect: [400, 0, 900, 350], surface: 'concrete', aliases: ['kitchen'] },
    { id: 'dining', label: 'Dining', rect: [400, 350, 900, 700], surface: 'concrete', aliases: ['dining', 'dining room'] },
    { id: 'living', label: 'Living room', rect: [900, 0, 1500, 700], surface: 'concrete', aliases: ['living', 'living room', 'lounge', 'tv'] },
    { id: 'hall', label: 'Hall', rect: [900, 700, 1050, 1600], surface: 'tile', aliases: ['hall', 'hallway', 'corridor'] },
    { id: 'study', label: 'Study', rect: [600, 700, 900, 1000], surface: 'wood', aliases: ['study', 'office'] },
    { id: 'bedroom3', label: 'Bedroom 3', rect: [600, 1000, 900, 1300], surface: 'wood', bedroom: true, aliases: ['bedroom 3', 'guest room'] },
    { id: 'laundry', label: 'Laundry', rect: [600, 1300, 900, 1600], surface: 'tile', aliases: ['laundry', 'utility'] },
    { id: 'main', label: 'Main bedroom', rect: [1050, 700, 1500, 1000], surface: 'wood', bedroom: true, aliases: ['main bedroom', 'master', 'master bedroom', 'bedroom'] },
    { id: 'bath', label: 'Bathroom', rect: [1050, 1000, 1500, 1150], surface: 'tile', aliases: ['bathroom', 'bath'] },
    { id: 'bedroom2', label: 'Bedroom 2', rect: [1050, 1150, 1500, 1600], surface: 'wood', bedroom: true, aliases: ['bedroom 2', 'kids room'] },
    { id: 'deck', label: 'Deck', rect: [0, 700, 600, 1150], surface: 'wood', outdoor: true, aliases: ['deck', 'terrace', 'patio'] },
    { id: 'yard', label: 'Back yard', rect: [0, 1150, 600, 1600], surface: 'grass', outdoor: true, aliases: ['yard', 'back yard', 'garden'] },
    { id: 'entry', label: 'Entrance', rect: [950, -260, 1250, 0], surface: 'paving', outdoor: true, aliases: ['entrance', 'front door', 'porch'] },
    { id: 'driveway', label: 'Driveway', rect: [30, -360, 370, 0], surface: 'gravel', outdoor: true, aliases: ['driveway'] },
    { id: 'roof', label: 'Roof', rect: [100, 100, 1400, 1500], surface: 'tile', pinsOnly: true, pinHeight: WALL_HEIGHT + 1.2, aliases: ['roof'] },
  ],
  exteriorWalls: [...north, ...west, ...east, ...south, ...courtSouth, ...courtWest],
  interiorWalls: [
    // garage | kitchen and dining
    [400, 0, 400, 500], [400, 580, 400, 700],
    // the bedroom wing's north wall (the corridor stays open to the living room)
    [600, 700, 900, 700], [1050, 700, 1500, 700],
    // corridor, west side: study, bedroom 3, laundry
    [900, 700, 900, 820], [900, 900, 900, 1120], [900, 1200, 900, 1420], [900, 1500, 900, 1600],
    [600, 1000, 900, 1000], [600, 1300, 900, 1300],
    // corridor, east side: main bedroom, bathroom, bedroom 2
    [1050, 700, 1050, 800], [1050, 880, 1050, 1040], [1050, 1110, 1050, 1250], [1050, 1330, 1050, 1600],
    [1050, 1000, 1500, 1000], [1050, 1150, 1500, 1150],
  ],
  doors: [
    [50, 0, 350, 0], // garage door
    [1050, 0, 1150, 0], // front door
    [400, 500, 400, 580], // garage → dining
    [700, 1600, 780, 1600], // laundry → yard
    [900, 820, 900, 900], [900, 1120, 900, 1200], [900, 1420, 900, 1500],
    [1050, 800, 1050, 880], [1050, 1040, 1050, 1110], [1050, 1250, 1050, 1330],
  ],
  windows: [
    [600, 0, 800, 0], [1250, 0, 1450, 0], // kitchen, living room
    [1500, 780, 1500, 920], [1500, 1300, 1500, 1450], // main bedroom, bedroom 2
    [600, 780, 600, 920], [600, 1080, 600, 1220], // study, bedroom 3 (onto the deck)
    [920, 1600, 1030, 1600], // end of the corridor
  ],
  // Sliding glass doors from the dining area onto the deck.
  glass: [[400, 700, 600, 700]],
  furniture: [
    { kind: 'car', rect: [110, 90, 290, 560], head: 'n' },
    { kind: 'counter', rect: [410, 10, 890, 70] },
    { kind: 'island', rect: [540, 170, 780, 240] },
    { kind: 'table', rect: [520, 440, 760, 600] },
    { kind: 'sofa', rect: [960, 200, 1060, 520], head: 'w' },
    { kind: 'round', rect: [1180, 310, 1280, 410] },
    { kind: 'tv', rect: [1492, 220, 1492, 500], head: 'e' },
    { kind: 'console', rect: [1450, 200, 1492, 520], head: 'e' },
    { kind: 'plant', rect: [920, 610, 980, 670] },
    { kind: 'door', rect: [1050, 0, 1150, 0], head: 's' },
    { kind: 'bed', rect: [1270, 730, 1470, 970], head: 'e' },
    { kind: 'wardrobe', rect: [1070, 930, 1240, 990] },
    { kind: 'bed', rect: [1300, 1360, 1480, 1580], head: 'e' },
    { kind: 'wardrobe', rect: [1070, 1160, 1250, 1220] },
    { kind: 'bed', rect: [620, 1120, 770, 1290], head: 'w' },
    { kind: 'table', rect: [650, 770, 850, 870] },
    { kind: 'toilet', rect: [1430, 1020, 1480, 1070] },
    { kind: 'counter', rect: [610, 1310, 670, 1590] },
    // Deck and back yard: a round table, planters and two pines
    { kind: 'round', rect: [180, 850, 320, 990] },
    { kind: 'planter', rect: [20, 720, 140, 780] }, { kind: 'planter', rect: [460, 1080, 580, 1140] },
    { kind: 'conifer', rect: [380, 1290, 500, 1410] }, { kind: 'conifer', rect: [90, 1420, 190, 1520] },
    { kind: 'shrub', rect: [250, 1480, 310, 1540] }, { kind: 'shrub', rect: [320, 1500, 380, 1560] },
    // Front: planters either side of the door
    { kind: 'planter', rect: [960, -90, 1030, -20] }, { kind: 'planter', rect: [1170, -90, 1240, -20] },
  ],
  cladding: [
    ...render(north, 'n'), ...render(west, 'w'), ...render(east, 'e'), ...render(south, 's'),
    ...render(courtSouth, 's'), ...render(courtWest, 'w'),
  ],
  lot: [-300, -450, 1750, 1800],
};
export default house;
