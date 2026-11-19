import { home } from './home';
import type { Device, ProviderId } from './types';

// Static details about the household's cars that the car's API doesn't return (model, colour,
// photos, manual). They come from the home configuration (`cars` in home/home.config.ts).
// A profile applies to every car from its provider; with several cars, set `vinSuffix` to the
// last characters of a VIN to target one. Keep VINs out when you can: they ship in the site bundle.

export interface CarPhoto {
  src: string;
  label: string;
  group: 'Exterior' | 'Interior';
}

export interface CarProfile {
  provider: ProviderId;
  vinSuffix?: string;
  name: string;
  model: string;
  year: number;
  powertrain: string;
  color: string;
  colorHex: string;
  manualUrl?: string;
  photos: CarPhoto[];
  photoCredit?: string;
}

export const CAR_PROFILES: CarProfile[] = home.cars ?? [];

export const profileFor = (car: Device) =>
  CAR_PROFILES.find(
    (p) => p.provider === car.provider && (!p.vinSuffix || car.providerId.toUpperCase().endsWith(p.vinSuffix.toUpperCase())),
  );
