import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The household configuration: home/ (private, git-ignored) when it exists, else the sample in
// home.example/. Everything personal (name, house plan, cars, photos) lives there.
const repo = fileURLToPath(new URL('..', import.meta.url));
// SMART_HOME_DIR picks another folder (e.g. SMART_HOME_DIR=home.example to see the sample).
const homeDir = process.env.SMART_HOME_DIR
  ? resolve(repo, process.env.SMART_HOME_DIR)
  : existsSync(`${repo}home/home.config.ts`) ? `${repo}home` : `${repo}home.example`;
const site = JSON.parse(readFileSync(`${homeDir}/site.json`, 'utf8')) as { appName: string; contactEmail?: string };

/** Fills %APP_NAME% and %CONTACT% in the HTML pages (index.html, terms.html). */
const siteText = (): Plugin => ({
  name: 'home-site-text',
  transformIndexHtml: (html) =>
    html
      .replaceAll('%APP_NAME%', site.appName)
      .replaceAll(
        '%CONTACT%',
        site.contactEmail ? `<a href="mailto:${site.contactEmail}">${site.contactEmail}</a>` : 'the person who runs this dashboard',
      ),
});

export default defineConfig({
  plugins: [react(), siteText()],
  resolve: { alias: { '@home': homeDir } },
  server: { port: 5173, fs: { allow: [repo] } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: 'index.html', terms: 'terms.html' } },
  },
});
