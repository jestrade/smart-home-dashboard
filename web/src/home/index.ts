// The household configuration, resolved at build time: `@home` is home/ when it exists,
// else home.example/ (see vite.config.ts and tsconfig.json).
import config from '@home/home.config';
import type { HomeConfig } from './types';

export const home: HomeConfig = config;

/** Puts the configured background photos on the page (CSS variables used by styles.css). */
export function applyHomeTheme() {
  const root = document.documentElement.style;
  const { light, dark } = home.backgrounds ?? {};
  if (light) root.setProperty('--bg-photo-light', `url("${light}")`);
  if (dark) root.setProperty('--bg-photo-dark', `url("${dark}")`);
  document.title = home.appName;
}
