// Test del confronto nel tempo (validation/lib/temporal.js): passaggi, ritardo dei punti caldi, Sørensen e sfasamento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniformGrid, cellToLatLon } from '../../engine/grid.js';
import { cellOf } from '../../validation/lib/hotspots.js';
import { groupPasses, temporalAnalysis, summarizeMembers, compareArrivals } from '../../validation/lib/temporal.js';

const START = Date.UTC(2019, 6, 28, 19, 0);
function geoGrid(rows, cols) {
  const g = uniformGrid(rows, cols);
  g.manifest = { crs: 'EPSG:32633', origin_utm: { x: 600000, y: 4500000 } };
  return g;
}
const hs = (g, r, c, min, sizeKm) => ({ ...cellToLatLon(g, r, c), time: new Date(START + min * 60000), sizeKm, instrument: 'VIIRS' });
const ones = (n) => new Uint8Array(n).fill(1);

test('passaggi: punti alla stessa ora nello stesso passaggio, in ordine di tempo, fuori zona scartati', () => {
  const g = geoGrid(100, 100);
  const far = { lat: 0, lon: 0, time: new Date(START), sizeKm: 0.375, instrument: 'MODIS' };
  const p = groupPasses(g, [hs(g, 50, 50, 90, 0.05), hs(g, 50, 20, 30, 0.05), hs(g, 50, 60, 30, 0.05), far], START, cellOf);
  assert.deepEqual(p.map((x) => [x.tMin, x.points.length]), [[30, 2], [90, 1]]);
});

test('ritardo: solo il fronte che arriva dopo il passaggio conta come errore', () => {
  const g = geoGrid(100, 100);
  const arrival = new Float32Array(g.n);
  for (let i = 0; i < g.n; i++) arrival[i] = i % 100;          // fronte verso est, 1 colonna al minuto
  const passes = groupPasses(g, [hs(g, 50, 20, 30, 0.05), hs(g, 50, 60, 30, 0.05)], START, cellOf);   // pixel di ±3 colonne
  const [p] = temporalAnalysis({ grid: g, arrival, passes, obsMask: ones(g.n), domain: ones(g.n), maxMin: 200, tolMin: 15 });
  assert.equal(p.points[0].lateMin, 0);                         // raggiunto al minuto 17, prima del passaggio
  assert.equal(p.points[1].lateMin, 27);                        // raggiunto al minuto 57: 27 minuti di ritardo
  assert.equal(p.hotspots.reachedByT, 0.5);
  assert.ok(Math.abs(p.hotspots.lateRmseMin - Math.sqrt(27 ** 2 / 2)) < 1e-9);
});

test('sfasamento: una simulazione in ritardo di 20 minuti ha sfasamento +20 e Sørensen 1 a t+20', () => {
  const g = geoGrid(100, 100);
  const obs = new Uint8Array(g.n), arrival = new Float32Array(g.n).fill(Infinity);
  for (let r = 19; r <= 81; r++) for (let c = 0; c < 100; c++) { arrival[r * 100 + c] = c + 20; if (c <= 31) obs[r * 100 + c] = 1; }
  // pixel di ±31 celle centrato in colonna 0 → righe 19-81, colonne 0-31: coincide con il perimetro finale
  const passes = groupPasses(g, [hs(g, 50, 0, 31, 0.61)], START, cellOf);
  const [p] = temporalAnalysis({ grid: g, arrival, passes, obsMask: obs, domain: ones(g.n), maxMin: 300 });
  assert.equal(p.area.bestLagMin, 20);
  assert.equal(p.area.sorensenBestLag, 1);
  assert.equal(p.area.referenceFinalPerimeter, 1);
  assert.ok(p.area.sorensen < 1 && p.area.recall < 1);
  // la stessa simulazione con innesco 20 minuti prima dell'ora del caso è in orario
  const [q] = temporalAnalysis({ grid: g, arrival, passes, obsMask: obs, domain: ones(g.n), maxMin: 300, offsetMin: -20 });
  assert.equal(q.area.bestLagMin, 0);
  assert.equal(q.area.sorensen, 1);
  const s = summarizeMembers([[p], [q]]);
  assert.equal(s.length, 1);
  assert.equal(s[0].members, 2);
});

test('codice contro codice: una mappa identica ha Sørensen 1 e differenza 0, una più lenta ha differenza positiva', () => {
  const n = 1000, a = new Float32Array(n), b = new Float32Array(n), dom = ones(n);
  for (let i = 0; i < n; i++) { a[i] = i; b[i] = i * 1.5; }
  const same = compareArrivals(a, a, dom, [100, 500]);
  assert.deepEqual(same.steps.map((s) => s.sorensen), [1, 1]);
  assert.equal(same.arrivalDiff.medianMin, 0);
  const slow = compareArrivals(a, b, dom, [300]);
  assert.ok(Math.abs(slow.steps[0].areaRatio - 201 / 301) < 1e-9);
  assert.ok(slow.arrivalDiff.medianMin > 0);
});
