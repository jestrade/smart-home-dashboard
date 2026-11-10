// The 3D house with one pin per device. Loaded lazily (three.js is large).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { displayName, type Device } from '../types';
import { FLOORS, toM, type Zone } from './plan';
import { createHouse, type HouseScene } from './scene';
import type { Pin } from './mapping';

export interface SceneProps {
  pins: Pin[];
  /** Plan zone id → the dashboard room names shown on it. */
  labels: Record<string, string[]>;
  selected: string | null;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}

const isActive = (d: Device) =>
  Boolean(d.state.on) || (d.type === 'cover' && (d.state.open || (d.state.position ?? 0) > 0)) || d.state.locked === false;

function pinValue(d: Device) {
  if (d.state.temperature != null) return `${Math.round(d.state.temperature)}°`;
  if (d.state.batteryPercent != null && d.type === 'vehicle') return `${d.state.batteryPercent}%`;
  if (d.type === 'solar' && d.state.powerKw != null) return `${d.state.powerKw} kW`;
  return null;
}

function zoneCentre(z: Zone) {
  const a = toM(z.rect[0], z.rect[1]);
  const b = toM(z.rect[2], z.rect[3]);
  return { x: (a.x + b.x) / 2, y: 0.05, z: (a.z + b.z) / 2 };
}

export default function FloorplanScene({ pins, labels, selected, editing, onSelect, onMove }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const houseRef = useRef<HouseScene | null>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());
  const labelEls = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<{ id: string; x: number; z: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const shown = useMemo(
    () => pins.map((p) => (drag && p.device.id === drag.id ? { ...p, x: drag.x, z: drag.z } : p)),
    [pins, drag],
  );
  const latest = useRef(shown);
  latest.current = shown;

  // Move the HTML pins and labels to where their 3D points land on screen, then draw.
  const frame = useRef(() => {});
  frame.current = () => {
    const h = houseRef.current;
    if (!h) return;
    h.render();
    for (const p of latest.current) {
      const el = pinEls.current.get(p.device.id);
      const s = h.project(p.x, p.y, p.z);
      if (el) {
        el.style.display = s ? '' : 'none';
        if (s) el.style.transform = `translate(${s.left}px, ${s.top}px) translate(-50%, -50%)`;
      }
    }
    for (const z of FLOORS) {
      const el = labelEls.current.get(z.id);
      if (!el) continue;
      const c = zoneCentre(z);
      const s = h.project(c.x, c.y, c.z);
      el.style.display = s ? '' : 'none';
      if (s) el.style.transform = `translate(${s.left}px, ${s.top}px) translate(-50%, -50%)`;
    }
  };

  useEffect(() => {
    let house: HouseScene;
    try {
      house = createHouse(canvasRef.current!);
    } catch {
      setFailed(true); // no WebGL
      return;
    }
    houseRef.current = house;
    const draw = () => frame.current();
    house.controls.addEventListener('change', draw);
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width && height) { house.resize(width, height); draw(); }
    });
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      house.controls.removeEventListener('change', draw);
      house.dispose();
      houseRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    houseRef.current?.setGlows(shown.filter((p) => p.device.type === 'light' && p.device.state.on && p.device.online));
    frame.current();
  });

  const startDrag = (e: React.PointerEvent, p: Pin) => {
    if (!editing) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    houseRef.current!.controls.enabled = false;
    setDrag({ id: p.device.id, x: p.x, z: p.z });
  };
  const moveDrag = (e: React.PointerEvent, p: Pin) => {
    if (!drag || drag.id !== p.device.id) return;
    const hit = houseRef.current?.pick(e.clientX, e.clientY, p.y);
    if (!hit) return;
    // Pins stay inside their own room.
    const a = toM(p.zone.rect[0], p.zone.rect[1]);
    const b = toM(p.zone.rect[2], p.zone.rect[3]);
    setDrag({ id: p.device.id, x: Math.min(b.x, Math.max(a.x, hit.x)), z: Math.min(b.z, Math.max(a.z, hit.z)) });
  };
  const endDrag = () => {
    if (!drag) return;
    houseRef.current!.controls.enabled = true;
    onMove(drag.id, Math.round(drag.x * 100) / 100, Math.round(drag.z * 100) / 100);
    setDrag(null);
  };

  if (failed) return <p className="fine">The 3D plan needs WebGL, which this browser does not offer.</p>;

  return (
    <div ref={wrapRef} className={`plan-stage ${editing ? 'editing' : ''}`}>
      <canvas ref={canvasRef} aria-label="3D model of the house" onClick={() => !editing && onSelect(null)} />
      <div className="plan-overlay">
        {/* Room names: the spaces in use, or every space while editing. */}
        {FLOORS.filter((z) => editing || labels[z.id]).map((z) => (
          <span key={z.id} ref={(el) => { if (el) labelEls.current.set(z.id, el); else labelEls.current.delete(z.id); }}
            className={`plan-label ${labels[z.id] ? 'mapped' : ''}`}>
            {labels[z.id]?.join(' · ') ?? z.label}
          </span>
        ))}
        {shown.map((p) => {
          const d = p.device;
          const value = pinValue(d);
          return (
            <button key={d.id} type="button"
              ref={(el) => { if (el) pinEls.current.set(d.id, el); else pinEls.current.delete(d.id); }}
              className={`plan-pin ${isActive(d) ? 'on' : ''} ${d.online ? '' : 'offline'} ${selected === d.id ? 'selected' : ''}`}
              title={`${displayName(d)} · ${p.zone.label}`}
              aria-label={`${displayName(d)}${value ? `, ${value}` : ''}${d.online ? '' : ', offline'}`}
              aria-pressed={selected === d.id}
              onClick={() => !editing && onSelect(selected === d.id ? null : d.id)}
              onPointerDown={(e) => startDrag(e, p)} onPointerMove={(e) => moveDrag(e, p)}
              onPointerUp={endDrag} onPointerCancel={endDrag}>
              <Icon name={d.type} size={16} />
              {value && <span className="plan-pin-value">{value}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn plan-reset" onClick={() => { houseRef.current?.resetView(); frame.current(); }}>
        Reset view
      </button>
    </div>
  );
}
