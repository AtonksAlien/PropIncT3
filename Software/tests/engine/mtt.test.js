// Test del modello C: ellisse di Anderson, coda di priorità, tempo di arrivo con Dijkstra.
// Casi analitici della roadmap (M3): senza vento il fronte è un cerchio; con vento un'ellisse con il rapporto atteso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuelbed, spread, windAdjustmentFactor, FT_TO_M } from '../../engine/rothermel.js';
import { lengthToWidth, eccentricity, rosAt, backingRos } from '../../engine/ellipse.js';
import { MinHeap } from '../../engine/heap.js';
import { runMTT, constantField } from '../../engine/mtt.js';
import { spreadField } from '../../engine/spreadfield.js';
import { uniformGrid } from '../../engine/grid.js';
import { parseFuelModels } from '../../engine/fuels.js';

/** Generatore pseudo-casuale riproducibile (mulberry32), solo per i test. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
const DRY = { m1: 0.06, m10: 0.07, m100: 0.08, herb: 0.60, woody: 0.90 };

// --- Ellisse contro Behave (testBehave.cpp: testLengthToWidthRatio, testDirectionOfInterest "FromIgnitionPoint")
const F = 2000 / 43560;
const GS4 = { depth: 2.1, mxDead: 0.40, w1: 1.9 * F, w10: 0.3 * F, w100: 0.1 * F, wHerb: 3.4 * F, wWoody: 7.1 * F, sav1: 1800, savHerb: 1600, savWoody: 1600, dynamic: true };
function gs4(tanSlope, windFrom, aspect) {
  const fb = fuelbed(GS4, DRY);
  return spread(fb, 5 * 88 * windAdjustmentFactor(2.1, 0.5, 30, 0.5), (windFrom + 180) % 360, tanSlope, aspect);
}
const eq6 = (obs, exp, name) => assert.ok(Math.abs(obs - exp) < 1e-6, `${name}: ${obs.toFixed(6)} invece di ${exp}`);

test('ellisse: rapporto lunghezza/larghezza come Behave (GS4, vento 45°, esposizione 95°, pendenza 30°)', () => {
  const r = gs4(Math.tan(Math.PI / 6), 45, 95);
  eq6(lengthToWidth(r.effWind * FT_TO_M), 1.375624, 'LW');
  assert.equal(lengthToWidth(0), 1);
  assert.equal(lengthToWidth(1e6), 8);   // limite massimo
});

test('ellisse: velocità dal punto di innesco in una direzione qualsiasi, come Behave', () => {
  for (const [windFrom, aspect, doi, exp] of [[280, 135, 30, 4.180938], [0, 45, 90, 3.438243], [280, 263, 285, 2.944975]]) {
    const r = gs4(0.3, windFrom, aspect);
    const e = eccentricity(lengthToWidth(r.effWind * FT_TO_M));
    eq6(rosAt(r.ros, e, r.dir, doi) / 1.1, exp, `vento ${windFrom}°, esposizione ${aspect}°, direzione ${doi}°`);
  }
  assert.ok(Math.abs(rosAt(10, 0.6, 90, 270) - backingRos(10, 0.6)) < 1e-12);
});

test('coda di priorità: estrae in ordine crescente anche con molti elementi', () => {
  const h = new MinHeap(4), rand = rng(42), keys = [];
  for (let k = 0; k < 5000; k++) { const x = rand() * 1000; keys.push(x); h.push(x, k); }
  keys.sort((a, b) => a - b);
  for (const k of keys) { h.pop(); assert.equal(h.lastKey, k); }
  assert.equal(h.size, 0);
});

// --- Modello C su griglie sintetiche
function field(grid, wind) { return spreadField(grid, MODELS, DRY, wind); }

/** Tempo di arrivo interpolato a distanza D (in celle) dall'innesco lungo l'azimut az. */
function arrivalAt(grid, arrival, r0, c0, az, D) {
  const r = Math.round(r0 - D * Math.cos((az * Math.PI) / 180));
  const c = Math.round(c0 + D * Math.sin((az * Math.PI) / 180));
  const d = Math.hypot(r - r0, c - c0) * grid.res;
  return { t: arrival[r * grid.cols + c], d };
}

test('modello C: senza vento e in piano il fronte è un cerchio (errore < 3% in 36 direzioni)', () => {
  const g = uniformGrid(241, 241, { fuel: 1 });
  const f = field(g, { ws10: 0, from: 0 });
  const R0 = f.ros[0];
  const { arrival } = runMTT(g, [{ r: 120, c: 120 }], constantField(f), { maxMin: 1e9 });
  let worst = 0;
  for (let az = 0; az < 360; az += 10) {
    const { t, d } = arrivalAt(g, arrival, 120, 120, az, 100);
    worst = Math.max(worst, Math.abs((t * R0) / d - 1));
  }
  assert.ok(worst < 0.03, `errore massimo ${(worst * 100).toFixed(2)}%`);
  // lungo gli assi il percorso è esatto
  const { t, d } = arrivalAt(g, arrival, 120, 120, 90, 100);
  assert.ok(Math.abs((t * R0) / d - 1) < 1e-4);
});

test('modello C: con vento da Ovest il fronte è un\'ellisse con testa, coda e larghezza attese', () => {
  const g = uniformGrid(301, 301, { fuel: 1 });
  const f = field(g, { ws10: 10, from: 270 });
  const rMax = f.ros[0], e = f.ecc[0], lw = lengthToWidth(f.effWind[0]);
  assert.ok(Math.abs(f.dir[0] - 90) < 1e-6 && lw > 1.5, `direzione ${f.dir[0]}, LW ${lw}`);
  const T = 140 * g.res / rMax;   // tempo in cui la testa percorre 140 celle
  const { arrival } = runMTT(g, [{ r: 150, c: 100 }], constantField(f), { maxMin: T });
  // estensione del bruciato sulla riga dell'innesco (Est/Ovest) e la larghezza massima (Nord/Sud)
  let east = 0, west = 0, rowMin = 1e9, rowMax = -1;
  for (let i = 0; i < g.n; i++) {
    if (!Number.isFinite(arrival[i])) continue;
    const r = (i / g.cols) | 0, c = i % g.cols;
    if (r === 150) { east = Math.max(east, c - 100); west = Math.max(west, 100 - c); }
    rowMin = Math.min(rowMin, r); rowMax = Math.max(rowMax, r);
  }
  const head = rMax * T / g.res, back = backingRos(rMax, e) * T / g.res;
  const width = (rowMax - rowMin + 1), length = east + west + 1;
  assert.ok(Math.abs(east - head) <= 2, `testa ${east} celle, attese ${head.toFixed(1)}`);
  assert.ok(Math.abs(west - back) <= 2, `coda ${west} celle, attese ${back.toFixed(1)}`);
  assert.ok(Math.abs(length / width - lw) / lw < 0.06, `L/W ${(length / width).toFixed(2)}, atteso ${lw.toFixed(2)}`);
});

test('modello C: il risultato non dipende da un passo di tempo (tempi proporzionali a 1/R)', () => {
  const g = uniformGrid(81, 81, { fuel: 1 });
  const slow = field(g, { ws10: 0, from: 0 });
  const fast = { ...slow, ros: slow.ros.map((v) => v * 2) };
  const a = runMTT(g, [{ r: 40, c: 40 }], constantField(slow), { maxMin: 1e9 }).arrival;
  const b = runMTT(g, [{ r: 40, c: 40 }], constantField(fast), { maxMin: 1e9 }).arrival;
  for (let i = 0; i < g.n; i += 97) assert.ok(Math.abs(a[i] - 2 * b[i]) < 1e-3 * a[i] + 1e-6);
});

test('modello C: fasce non combustibili dritte e diagonali non vengono scavalcate', () => {
  const g = uniformGrid(101, 101, { fuel: 10 });
  for (let r = 0; r < 101; r++) g.fuel[r * 101 + 70] = 0;          // fascia verticale larga 1 cella
  for (let k = 0; k < 101; k++) g.fuel[k * 101 + (100 - k)] = 0;  // e una diagonale, a cui si arriva solo d'angolo
  const f = field(g, { ws10: 8, from: 270 });
  const { arrival } = runMTT(g, [{ r: 50, c: 20 }], constantField(f), { maxMin: 1e9 });
  for (let r = 0; r < 101; r++) for (let c = 71; c < 101; c++) {
    assert.equal(arrival[r * 101 + c], Infinity, `r${r} c${c} raggiunta oltre la fascia`);
  }
  for (let r = 0; r < 101; r++) for (let c = 0; c < 101; c++) {
    if (c + r > 100) assert.equal(arrival[r * 101 + c], Infinity, `r${r} c${c} oltre la diagonale`);
  }
});

test('modello C: in salita più veloce che in discesa', () => {
  const g = uniformGrid(161, 161, { fuel: 1, slopeDeg: 20, aspectDeg: 180 });   // si sale verso Nord
  const f = field(g, { ws10: 0, from: 0 });
  const { arrival } = runMTT(g, [{ r: 80, c: 80 }], constantField(f), { maxMin: 1e9 });
  const north = arrival[(80 - 60) * 161 + 80], south = arrival[(80 + 60) * 161 + 80];
  assert.ok(south > 1.5 * north, `N ${north.toFixed(1)} min, S ${south.toFixed(1)} min`);
});

// --- Campo su richiesta (giorno 11): stessi tempi di arrivo, bit per bit, del campo completo
import { existsSync } from 'node:fs';
import { loadZone } from '../../engine/load-node.js';
import { makeWeather, lazyFieldAt, FIELD_STEP_MIN } from '../../engine/simulate.js';

const ZONE = join(ROOT, 'data/zones/mercadante/processed');
const METEO = join(ROOT, 'data/zones/mercadante/raw/meteo/ecmwf_ifs_2023-07-22_2023-07-25_40.8818_16.6854.json');
test('modello C: campo su richiesta identico al campo completo (Mercadante, meteo variabile)', { skip: !(existsSync(ZONE) && existsSync(METEO)) && 'dati assenti' }, () => {
  const grid = loadZone(ZONE);
  const wx = makeWeather({ hourlyJson: JSON.parse(readFileSync(METEO, 'utf8')), start: new Date('2023-07-25T13:00:00+02:00'), durMin: 180 });
  const full = new Map();
  const fullAt = (t) => {
    const k = Math.floor(t / FIELD_STEP_MIN);
    if (!full.has(k)) { const w = wx.at(k * FIELD_STEP_MIN); full.set(k, spreadField(grid, MODELS, w.moist, { ws10: w.ws10, from: w.from })); }
    return full.get(k);
  };
  const ign = [{ r: 480, c: 200 }, { r: 271, c: 294 }];
  const a = runMTT(grid, ign, fullAt, { maxMin: 180 }).arrival;
  const lazy = lazyFieldAt(grid, MODELS, wx);
  const b = runMTT(grid, ign, lazy.fieldAt, { maxMin: 180 }).arrival;
  assert.deepEqual(b, a);
  assert.ok(lazy.field.computed < grid.n * full.size / 4, `celle calcolate ${lazy.field.computed} su ${grid.n * full.size}`);
});
