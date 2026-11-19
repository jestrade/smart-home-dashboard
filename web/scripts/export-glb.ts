// Saves the house model as a binary glTF: npm run export:glb [output path] [car .glb …]
// Without car models the simple generic car is exported.
// Same geometry as the Home tab's 3D plan (web/src/floorplan). Units are metres, y up.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildHouse, upgradeCars } from '../src/floorplan/scene';

// GLTFExporter reads its output Blob with FileReader, which Node lacks.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
(globalThis as Record<string, unknown>).FileReader ??= NodeFileReader;

const out = resolve(process.argv[2] ?? 'house.glb');
const house = buildHouse();
const cars = process.argv.slice(3).map((path) => {
  const b = readFileSync(resolve(path));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});
await upgradeCars(house, cars);
house.updateMatrixWorld(true);

const glb = await new GLTFExporter().parseAsync(house, { binary: true });
writeFileSync(out, Buffer.from(glb as ArrayBuffer));
console.log(`Saved ${out} (${Math.round((glb as ArrayBuffer).byteLength / 1024)} KB)`);
