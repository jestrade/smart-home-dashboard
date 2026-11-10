// Which dashboard room sits where on the plan, and where each device's pin goes.
import { roomOf, type Device } from '../types';
import { ZONES, toM, type Zone } from './plan';

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const BEDROOM_WORDS = /^(cuarto|alcoba|habitacion|dormitorio|bedroom|room)\b/;

/**
 * Dashboard room → plan zone id. Saved choices win; otherwise names are matched against each
 * zone's aliases, and leftover "Cuarto …" rooms fill the free bedrooms in order.
 */
export function zoneMap(rooms: string[], saved: Record<string, string> = {}): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pending: string[] = [];
  for (const r of rooms) {
    if (r in saved) { out[r] = saved[r] || null; continue; }
    const n = norm(r);
    const z = ZONES.find((zone) => zone.aliases.includes(n)) ?? ZONES.find((zone) => norm(zone.label) === n);
    if (z) out[r] = z.id;
    else pending.push(r);
  }
  const taken = new Set(Object.values(out));
  const freeBedrooms = ZONES.filter((z) => z.bedroom && !taken.has(z.id));
  for (const r of pending.sort()) {
    out[r] = BEDROOM_WORDS.test(norm(r)) && freeBedrooms.length ? freeBedrooms.shift()!.id : null;
  }
  return out;
}

export interface Pin {
  device: Device;
  zone: Zone;
  x: number;
  z: number;
  y: number;
}

/** Devices spread on a small grid inside their zone, unless a position was saved. */
export function placePins(devices: Device[], map: Record<string, string | null>, saved: Record<string, number[]> = {}): Pin[] {
  const byZone = new Map<string, Device[]>();
  for (const d of devices) {
    const zid = map[roomOf(d)];
    if (!zid) continue;
    byZone.set(zid, [...(byZone.get(zid) ?? []), d]);
  }
  const pins: Pin[] = [];
  for (const [zid, list] of byZone) {
    const zone = ZONES.find((z) => z.id === zid)!;
    const a = toM(zone.rect[0], zone.rect[1]);
    const b = toM(zone.rect[2], zone.rect[3]);
    const w = b.x - a.x;
    const h = b.z - a.z;
    // Lay devices out on a grid that follows the zone's shape (a long alley gets one column).
    const cols = Math.max(1, Math.min(list.length, Math.round(Math.sqrt((list.length * w) / h)) || 1));
    const rows = Math.ceil(list.length / cols);
    const inside = (p?: number[]) => p && p[0] >= a.x && p[0] <= b.x && p[1] >= a.z && p[1] <= b.z;
    list.sort((p, q) => p.id.localeCompare(q.id)).forEach((device, i) => {
      // A saved spot only counts while the device is still in the same room.
      const s = inside(saved[device.id]) ? saved[device.id] : undefined;
      const c = i % cols;
      const r = Math.floor(i / cols);
      pins.push({
        device,
        zone,
        x: s ? s[0] : a.x + (w * (c + 0.5)) / cols,
        z: s ? s[1] : a.z + (h * (r + 0.5)) / rows,
        y: zone.pinHeight ?? 1.2,
      });
    });
  }
  return pins;
}
