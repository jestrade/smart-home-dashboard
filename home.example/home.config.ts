// Sample household configuration. Copy this folder to home/ (git-ignored) and make it yours:
//   cp -R home.example home
// The app uses home/ when it exists and falls back to this sample otherwise.
import type { HomeConfig } from '../web/src/home/types';
import site from './site.json';

// The 3D floor plan lives in house.ts (no images there, so it can also be exported to .glb).
const config: HomeConfig = {
  appName: site.appName,
  // Car details the car's API doesn't return (model, colour, photos). Import photos like
  // `import side from './car/side.webp'` and list them here. See web/src/carProfiles.ts.
  cars: [],
  // Optional page backgrounds: `import light from './bg/light.jpg'` → { light, dark }.
  backgrounds: {},
};
export default config;
