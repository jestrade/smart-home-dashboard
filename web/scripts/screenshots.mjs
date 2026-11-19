// Takes the README screenshots from the demo with the sample home:
//   npm --prefix web run demo:sample          (in one terminal, serves http://localhost:5175)
//   node web/scripts/screenshots.mjs          (in another; writes docs/screenshots/*.webp)
// Uses the installed Google Chrome, headless, over the DevTools protocol (no extra packages).
// CHROME=/path/to/chrome and URL=http://… override the defaults.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.URL ?? 'http://localhost:5175/';
const OUT = resolve(fileURLToPath(new URL('../../docs/screenshots', import.meta.url)));
const PORT = 9333;

const VIEWS = [
  { name: 'desktop', width: 1280, height: 860, deviceScaleFactor: 2, mobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
];
/** Tab label (desktop label first; phones may show a shorter one) and how long to let it settle. */
const PAGES = [
  { file: 'home', tab: ['Home'], settle: 6000, scrollTo: '.plan-filter' },
  { file: 'energy', tab: ['Energy'], settle: 2500 },
  { file: 'setup', tab: ['Integrations', 'Setup'], settle: 2000 },
  { file: 'activity', tab: ['Activity'], settle: 2000 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shots-'))}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--lang=en-US', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { ok, fail } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? fail(new Error(m.error.message)) : ok(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    pending.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
// A neutral time zone, so the clock widget doesn't reveal where the screenshots were taken.
await send('Emulation.setLocaleOverride', { locale: 'en-US' });
await send('Emulation.setTimezoneOverride', { timezoneId: process.env.SHOTS_TZ ?? 'America/New_York' });
for (const v of VIEWS) {
  await send('Emulation.setDeviceMetricsOverride', v);
  await send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile });
  await send('Page.navigate', { url: BASE });
  await sleep(3000);
  for (const p of PAGES) {
    const clicked = await evaluate(`(() => {
      const labels = ${JSON.stringify(p.tab)};
      const b = [...document.querySelectorAll('button, a')].find((el) => el.offsetParent && labels.some((l) => el.textContent.trim().startsWith(l)));
      b?.click();
      window.scrollTo(0, 0);
      return Boolean(b);
    })()`);
    if (!clicked.result.value) throw new Error(`No "${p.tab[0]}" tab on ${v.name}`);
    await sleep(p.settle);
    await evaluate(p.scrollTo
      ? `(() => { const el = document.querySelector(${JSON.stringify(p.scrollTo)}); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); })()`
      : 'window.scrollTo(0, 0)');
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
    const file = join(OUT, `${v.name}-${p.file}.webp`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('saved', file);
  }
}
ws.close();
chrome.kill();
