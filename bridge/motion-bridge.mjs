#!/usr/bin/env node
// Motion Blinds home bridge for Home Dashboard.
//
// Runs on an always-on computer on the same network as the Motion gateway (Mac, Raspberry Pi…).
// - Talks to the gateway over its local UDP API (the "Motion key" from the app never leaves home).
// - Reports blind state to the dashboard every minute and whenever a blind moves.
// - Polls the dashboard for commands (open / close / stop / position) and runs them.
//
// Usage:  node motion-bridge.mjs            (reads ./config.json, see config.example.json)
// Needs Node.js 18+. No npm packages.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const MULTICAST = '238.0.0.18';
const PORT_SEND = 32100; // gateway listens here
const PORT_REPORT = 32101; // gateway multicasts reports / heartbeats here
const REPORT_EVERY_MS = 60_000;
const POLL_EVERY_MS = 4_000;
const REFRESH_LIST_EVERY_MS = 10 * 60_000;

// ---------- config ----------

function loadConfig() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const file = process.env.MOTION_BRIDGE_CONFIG || path.join(dir, 'config.json');
  const fromFile = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = {
    endpoint: process.env.BRIDGE_ENDPOINT || fromFile.endpoint,
    token: process.env.BRIDGE_TOKEN || fromFile.token,
    key: process.env.MOTION_KEY || fromFile.key,
    gatewayIp: process.env.MOTION_GATEWAY_IP || fromFile.gatewayIp || null,
  };
  const missing = ['endpoint', 'token', 'key'].filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in ${file} (or environment). See config.example.json.`);
    process.exit(1);
  }
  if (!/^[\x20-\x7e]{16}$/.test(cfg.key)) {
    console.error('The Motion key must be the 16-character key from the Motion Blinds app (About → tap 5 times).');
    process.exit(1);
  }
  cfg.endpoint = cfg.endpoint.replace(/\/$/, '');
  return cfg;
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Motion gateway (UDP) ----------

const pad = (n, l = 2) => String(n).padStart(l, '0');
const msgId = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
};

/** AccessToken = AES-128-ECB(key, gateway token), hex upper-case. */
export function accessToken(token, key) {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(token, 'utf8')), c.final()]).toString('hex').toUpperCase();
}

export class MotionGateway {
  constructor({ key, gatewayIp, onReport }) {
    this.key = key;
    this.ip = gatewayIp;
    this.onReport = onReport;
    this.token = null;
    this.blinds = new Map(); // mac -> { mac, deviceType, ...state }
    this.pending = new Map(); // msgID -> { resolve, reject, timer }
    this.cmd = dgram.createSocket('udp4');
    this.cmd.on('message', (buf, rinfo) => this.#onMessage(buf, rinfo));
    this.mcast = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.mcast.on('message', (buf, rinfo) => this.#onMessage(buf, rinfo));
    this.mcast.on('error', (e) => log('multicast listener error (reports will rely on polling):', e.message));
  }

  async start() {
    await new Promise((r) => this.cmd.bind(0, r));
    await new Promise((r) => this.mcast.bind(PORT_REPORT, () => {
      try { this.mcast.addMembership(MULTICAST); } catch (e) { log('could not join multicast group:', e.message); }
      r();
    })).catch(() => {});
  }

  close() {
    this.cmd.close();
    try { this.mcast.close(); } catch { /* already closed */ }
  }

  #onMessage(buf, rinfo) {
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (m.msgType === 'Heartbeat' && m.token) this.token = m.token;
    if ((m.msgType === 'Report' || m.msgType === 'ReadDeviceAck' || m.msgType === 'WriteDeviceAck') && m.mac && m.data) {
      this.#updateBlind(m.mac, m.deviceType, m.data);
    }
    if (m.msgType === 'Report') this.onReport?.();
    if (!this.ip && m.msgType === 'GetDeviceListAck') this.ip = rinfo.address;
    const p = m.msgID && this.pending.get(m.msgID);
    // Some firmware does not echo msgID; fall back to the oldest request of the matching type.
    const target = p || [...this.pending.values()].find((x) => x.ack === m.msgType && (!x.mac || x.mac === m.mac));
    if (target) {
      clearTimeout(target.timer);
      this.pending.delete(target.id);
      const err = m.errorCode ?? m.data?.errorCode;
      if (err) target.reject(new Error(`gateway error ${err}`));
      else target.resolve(m);
    }
  }

  #updateBlind(mac, deviceType, d) {
    const prev = this.blinds.get(mac) ?? { mac, deviceType };
    this.blinds.set(mac, {
      ...prev,
      deviceType: deviceType ?? prev.deviceType,
      type: d.type ?? prev.type,
      position: d.currentPosition ?? prev.position,
      angle: d.currentAngle ?? prev.angle,
      batteryVolts: typeof d.batteryLevel === 'number' && d.batteryLevel > 0 ? d.batteryLevel / 100 : prev.batteryVolts,
      rssi: d.RSSI ?? prev.rssi,
      online: true,
      seenAt: Date.now(),
    });
  }

  #request(msg, ack, { mac, timeoutMs = 3000 } = {}) {
    const id = msgId() + Math.floor(Math.random() * 10);
    const body = { ...msg, msgID: id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${msg.msgType} timed out`)); }, timeoutMs);
      this.pending.set(id, { id, ack, mac, resolve, reject, timer });
      this.cmd.send(JSON.stringify(body), PORT_SEND, this.ip || MULTICAST);
    });
  }

  async #retry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) { last = e; }
    }
    throw last;
  }

  async refreshDeviceList() {
    const r = await this.#retry(() => this.#request({ msgType: 'GetDeviceList' }, 'GetDeviceListAck'));
    this.token = r.token ?? this.token;
    this.gatewayMac = r.mac;
    const seen = new Set();
    for (const d of r.data ?? []) {
      if (!String(d.deviceType).startsWith('1')) continue; // 02000002 = the gateway itself
      seen.add(d.mac);
      if (!this.blinds.has(d.mac)) this.blinds.set(d.mac, { mac: d.mac, deviceType: d.deviceType, online: true });
    }
    for (const mac of this.blinds.keys()) if (!seen.has(mac)) this.blinds.delete(mac);
    return this.blinds.size;
  }

  #auth() {
    if (!this.token) throw new Error('no gateway token yet');
    return accessToken(this.token, this.key);
  }

  async readAll() {
    for (const b of this.blinds.values()) {
      try {
        await this.#retry(() => this.#request(
          { msgType: 'ReadDevice', mac: b.mac, deviceType: b.deviceType, AccessToken: this.#auth() }, 'ReadDeviceAck', { mac: b.mac },
        ), 2);
      } catch (e) {
        this.blinds.set(b.mac, { ...b, online: false });
        log(`blind ${b.mac} did not answer: ${e.message}`);
      }
    }
  }

  async write(mac, data) {
    const b = this.blinds.get(mac);
    if (!b) throw new Error(`unknown blind ${mac}`);
    return this.#retry(() => this.#request(
      { msgType: 'WriteDevice', mac, deviceType: b.deviceType, AccessToken: this.#auth(), data }, 'WriteDeviceAck', { mac },
    ), 2);
  }

  snapshot() {
    return [...this.blinds.values()].map(({ mac, type, position, angle, batteryVolts, rssi, online }) =>
      ({ mac, type, position, angle, batteryVolts, rssi, online }));
  }
}

// ---------- dashboard API ----------

async function api(cfg, method, route, body) {
  const res = await fetch(`${cfg.endpoint}/${route}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'User-Agent': `motion-bridge/${VERSION}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('The dashboard rejected the bridge token. Generate a new one on the Motion Blinds card.'), { fatal: true });
  if (!res.ok) throw new Error(`${method} ${route} → HTTP ${res.status}`);
  return res.json();
}

/** Dashboard command → Motion WriteDevice data. Dashboard positions are % open; Motion's are % closed. */
export function toMotion(action, value) {
  if (action === 'cover') {
    const op = { close: 0, open: 1, stop: 2 }[value];
    if (op === undefined) throw new Error(`unknown cover command ${value}`);
    return { operation: op };
  }
  if (action === 'setPosition') return { targetPosition: 100 - Math.max(0, Math.min(100, Math.round(value))) };
  throw new Error(`unsupported action ${action}`);
}

export async function run(cfg, { once = false } = {}) {
  let reportSoon = null;
  const gw = new MotionGateway({
    key: cfg.key,
    gatewayIp: cfg.gatewayIp,
    onReport: () => { clearTimeout(reportSoon); reportSoon = setTimeout(() => report().catch((e) => log('report failed:', e.message)), 1500); },
  });
  await gw.start();

  const report = async () => {
    const r = await api(cfg, 'POST', 'report', { devices: gw.snapshot(), bridgeVersion: VERSION });
    log(`reported ${r.devices} blind(s)`);
  };
  const cycle = async () => {
    await gw.refreshDeviceList();
    await gw.readAll();
    await report();
  };
  const poll = async () => {
    const { commands } = await api(cfg, 'GET', 'commands');
    for (const c of commands) {
      try {
        await gw.write(c.deviceId, toMotion(c.action, c.value));
        log(`ran ${c.action} ${c.value ?? ''} on ${c.deviceId}`);
        await api(cfg, 'POST', 'result', { id: c.id, ok: true, state: {} });
      } catch (e) {
        log(`command ${c.id} failed: ${e.message}`);
        await api(cfg, 'POST', 'result', { id: c.id, ok: false, error: e.message }).catch(() => {});
      }
    }
    return commands.length;
  };

  await cycle();
  log(`connected to gateway ${gw.ip ?? '(multicast)'} with ${gw.blinds.size} blind(s)`);
  if (once) return { gw, poll, report, cycle };

  const guard = (name, fn) => async () => {
    try { await fn(); } catch (e) {
      log(`${name} failed: ${e.message}`);
      if (e.fatal) process.exit(2);
    }
  };
  setInterval(guard('poll', poll), POLL_EVERY_MS);
  setInterval(guard('read', async () => { await gw.readAll(); await report(); }), REPORT_EVERY_MS);
  setInterval(guard('device list', () => gw.refreshDeviceList()), REFRESH_LIST_EVERY_MS);
  return { gw };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cfg = loadConfig();
  log(`Motion bridge ${VERSION} → ${cfg.endpoint}`);
  run(cfg).catch((e) => { log('startup failed:', e.message); process.exit(1); });
}
