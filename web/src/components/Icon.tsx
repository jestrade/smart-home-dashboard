import type { DeviceType } from '../types';

const PATHS: Record<string, string> = {
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z',
  switch: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm5 4v4',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5',
  fan: 'M12 12c0-4 1-8 4-8s3 4 0 6M12 12c4 0 8 1 8 4s-4 3-6 0M12 12c0 4-1 8-4 8s-3-4 0-6M12 12c-4 0-8-1-8-4s4-3 6 0',
  thermostat: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0ZM12 9v7',
  sensor: 'M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8.5 15.5a5 5 0 0 1 7 0M5.6 12.6a9 9 0 0 1 12.8 0',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  cover: 'M4 4h16M6 4v16M18 4v16M6 8h12M6 12h12M6 16h12',
  camera: 'M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  vehicle: 'M5 17h14v-5l-2-5H7l-2 5v5Zm0 0v2m14-2v2M5 12h14M8 14.5h.01M16 14.5h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18Z',
  partly: 'M8 2.5v1M3.6 4.6l.7.7M2 9h1M5.2 11.4A3 3 0 1 1 10.8 8M10 20h7a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 8.6 14.3 3 3 0 0 0 10 20Z',
  rain: 'M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 8 3.5 3.5 0 0 0 7 15ZM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  snow: 'M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 8 3.5 3.5 0 0 0 7 15ZM8 19h.01M12 20h.01M16 19h.01',
  storm: 'M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 8 3.5 3.5 0 0 0 7 15ZM12.5 15l-2 3.5h3l-2 3.5',
  fog: 'M4 10h16M6 14h12M8 18h8M7 6h10',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4',
  chevron: 'm6 9 6 6 6-6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  charger: 'M6 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h14M16 9h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-2-2M11.5 7 9 11.5h3L9.5 16',
  other: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8m0-4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z',
  home: 'M3 11 12 4l9 7M5 10v10h14V10',
  plug2: 'M8 12h8M12 8v8M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  climate: 'M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9',
  horn: 'M3 10v4h4l5 4V6L7 10H3Zm13-1a4 4 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11',
  pin: 'M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z',
  close: 'M6 6l12 12M18 6 6 18',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | DeviceType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.other} />
    </svg>
  );
}
