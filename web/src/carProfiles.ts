import type { Device, ProviderId } from './types';

// Static details about your own cars that Volvo's API doesn't return for this app
// (model, colour, photos, manual). A profile applies to every car from its provider;
// with several cars, set `vinSuffix` to the last characters of a VIN to target one.
// Keep VINs out of this file when you can: it ships in the public site bundle.

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

export const CAR_PROFILES: CarProfile[] = [
  {
    provider: 'volvo',
    name: 'XC40 Recharge',
    model: 'XC40 Recharge Pure Electric',
    year: 2024,
    powertrain: 'Pure electric',
    color: 'Baltic Blue',
    colorHex: '#5b7288',
    manualUrl:
      'https://www.volvocars.com/static/support-content/pdfs/ar_es-ES_xc40-recharge-pure-electric_2024_UM_33d5504987c179188f5321a5c840cc89.pdf',
    photos: [
      { src: '/car/front-three-quarter.webp', label: 'Front three-quarter', group: 'Exterior' },
      { src: '/car/side.webp', label: 'Side', group: 'Exterior' },
      { src: '/car/rear-three-quarter.webp', label: 'Rear three-quarter', group: 'Exterior' },
      { src: '/car/front.webp', label: 'Front', group: 'Exterior' },
      { src: '/car/rear.webp', label: 'Rear', group: 'Exterior' },
      { src: '/car/dashboard.webp', label: 'Dashboard', group: 'Interior' },
      { src: '/car/console.webp', label: 'Centre console', group: 'Interior' },
      { src: '/car/seats.webp', label: 'Seats', group: 'Interior' },
    ],
    photoCredit: 'Photos: Volvo Cars, via autobuzz.my',
  },
];

export const profileFor = (car: Device) =>
  CAR_PROFILES.find(
    (p) => p.provider === car.provider && (!p.vinSuffix || car.providerId.toUpperCase().endsWith(p.vinSuffix.toUpperCase())),
  );
