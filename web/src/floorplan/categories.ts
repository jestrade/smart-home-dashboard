// Device groups for filtering the floor plan with one tap.
import { deviceIcon } from '../components/Icon';
import type { Device } from '../types';

export interface Category {
  id: string;
  label: string;
  icon: string;
}

export const CATEGORIES: Category[] = [
  { id: 'lights', label: 'Lights', icon: 'light' },
  { id: 'climate', label: 'Climate', icon: 'ac' },
  { id: 'cameras', label: 'Cameras', icon: 'camera' },
  { id: 'car', label: 'Car & charger', icon: 'vehicle' },
  { id: 'security', label: 'Locks & alarms', icon: 'lock' },
  { id: 'blinds', label: 'Blinds', icon: 'cover' },
  { id: 'sensors', label: 'Sensors', icon: 'sensor' },
  { id: 'power', label: 'Plugs & switches', icon: 'plug' },
  { id: 'solar', label: 'Solar', icon: 'solar' },
  { id: 'other', label: 'Others', icon: 'other' },
];

/** The group a device belongs to, from its type or (for generic plugs and switches) its name. */
export function categoryOf(d: Device): string {
  const icon = deviceIcon(d);
  switch (icon) {
    case 'light': return 'lights';
    case 'thermostat': case 'fan': case 'ac': case 'air': return 'climate';
    case 'camera': return 'cameras';
    case 'vehicle': case 'charger': return 'car';
    case 'lock': case 'bell': return 'security';
    case 'cover': return 'blinds';
    // Temperature and humidity sensors belong with the climate; motion, door and water sensors do not.
    case 'sensor': return d.state.temperature != null || d.state.humidity != null ? 'climate' : 'sensors';
    case 'plug': case 'switch': return 'power';
    case 'solar': return 'solar';
    default: return 'other';
  }
}
