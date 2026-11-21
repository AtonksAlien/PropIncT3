// Test del motore: node --test tests/engine/   (dalla cartella Software)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNpy } from '../../engine/npy.js';
import { loadZone } from '../../engine/load-node.js';
import { parseFuelModels } from '../../engine/fuels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** .npy versione 1 costruito a mano, come lo scrive NumPy. */
function makeNpy(descr, shape, typed) {
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  header += ' '.repeat(pad % 64) + '\n';
  const out = new Uint8Array(10 + header.length + typed.byteLength);
  out.set([0x93, 78, 85, 77, 80, 89, 1, 0]);
  new DataView(out.buffer).setUint16(8, header.length, true);
  out.set(new TextEncoder().encode(header), 10);
  out.set(new Uint8Array(typed.buffer), 10 + header.length);
  return out.buffer;
}

test('npy: legge float32 e uint8 con la forma corretta', () => {
  const f = parseNpy(makeNpy('<f4', [2, 3], new Float32Array([1, 2, 3, 4, 5, 6.5])));
  assert.deepEqual(f.shape, [2, 3]);
  assert.ok(f.data instanceof Float32Array);
  assert.equal(f.data[5], 6.5);
  const u = parseNpy(makeNpy('|u1', [4], new Uint8Array([0, 1, 10, 255])));
  assert.deepEqual([...u.data], [0, 1, 10, 255]);
});

test('combustibili: Anderson 13 letti e convertiti in SI', () => {
  const m = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  assert.equal(m.filter(Boolean).length, 13);
  assert.ok(Math.abs(m[1].w1h - 0.74 * 0.22417) < 1e-6);   // 0,166 kg/m²
  assert.ok(Math.abs(m[1].depth - 0.3048) < 1e-9);
  assert.equal(m[10].mxDead, 0.25);
  assert.ok(m[10].wWoody > 0 && m[2].wHerb > 0);
});

const zoneDir = join(ROOT, 'data/zones/mercadante/processed');
test('pacchetto Mercadante: caricato in TypedArray coerenti', { skip: !existsSync(zoneDir) && 'pacchetto non presente' }, () => {
  const g = loadZone(zoneDir);
  assert.equal(g.n, 600 * 600);
  assert.ok(g.fuel instanceof Uint8Array && g.slope instanceof Float32Array);
  assert.ok([...g.fuel].every((f) => f <= 13));
  let minZ = Infinity, maxZ = -Infinity;
  for (const z of g.elevation) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  assert.ok(minZ > 300 && maxZ < 550, `quote ${minZ}-${maxZ}`);
});

test('confronto tra due mappe di arrivo: conteggi e indici, celle non raggiunte escluse', async () => {
  const { compareArrivals } = await import('../../engine/simulate.js');
  const I = Infinity;
  const a = Float32Array.of(0, 10, 50, I, I, 30);
  const b = Float32Array.of(0, 20, I, 40, I, 90);
  const all = compareArrivals(a, b);                       // in comune: 0, 1, 5 · solo a: 2 · solo b: 3
  assert.deepEqual([all.both, all.onlyA, all.onlyB], [3, 1, 1]);
  assert.ok(Math.abs(all.sorensen - 6 / 8) < 1e-12 && Math.abs(all.jaccard - 3 / 5) < 1e-12);
  const at25 = compareArrivals(a, b, 25);                  // entro 25 min: in comune 0, 1
  assert.deepEqual([at25.both, at25.onlyA, at25.onlyB], [2, 0, 0]);
  assert.equal(compareArrivals(Float32Array.of(I), Float32Array.of(I)).sorensen, 1);   // nessuna cella: identici
});
