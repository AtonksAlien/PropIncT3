// Pioggia durante la simulazione: il combustibile fine si bagna (tempo di risposta 1 h) e, superata l'umidità
// di estinzione, il fronte si ferma. Documenta anche un limite dichiarato: dopo la pioggia il fronte non riparte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniformGrid } from '../../engine/grid.js';
import { parseFuelModels } from '../../engine/fuels.js';
import { makeWeather, simulate } from '../../engine/simulate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
const START = new Date('2023-07-25T11:00:00Z');
const MAX = 300;   // 5 ore simulate

/** Meteo estivo (33 °C, 25%, vento 6 m/s da Ovest) con 3 mm/h di pioggia tra le ore [da, a) dall'innesco. */
function weather(rain = null) {
  const s0 = START.getTime() / 1000, t0 = s0 - 3 * 86400, n = 5 * 24;
  const time = Array.from({ length: n }, (_, i) => t0 + i * 3600);
  const fill = (v) => Array(n).fill(v);
  // il valore orario di Open-Meteo è la pioggia caduta nell'ora precedente
  const precipitation = time.map((t) => (rain && t > s0 + rain[0] * 3600 && t <= s0 + rain[1] * 3600 ? 3 : 0));
  return makeWeather({ start: START, durMin: MAX, hourlyJson: { hourly: { time, temperature_2m: fill(33), relative_humidity_2m: fill(25),
    wind_speed_10m: fill(6), wind_direction_10m: fill(270), wind_gusts_10m: fill(9), precipitation } } });
}
function run(rain) {
  const g = uniformGrid(300, 300, { fuel: 1, slopeDeg: 0, ndvi: 0.3 });   // erba, umidità di estinzione 12%
  return simulate(g, MODELS, { ignitions: [{ r: 150, c: 40 }], maxMin: MAX, barriers: false, liveNdvi: false }, weather(rain)).arrival;
}
const burned = (arr, t) => { let k = 0; for (const a of arr) if (a <= t) k++; return k; };
const lastArrival = (arr) => { let m = 0; for (const a of arr) if (Number.isFinite(a) && a > m) m = a; return m; };

test('pioggia dall\'innesco: il fuoco si ferma entro circa un\'ora e brucia molto meno', () => {
  const dry = run(null), wet = run([0, 99]);
  assert.ok(lastArrival(wet) <= 70, `ultimo arrivo a ${lastArrival(wet)} min`);
  assert.equal(burned(wet, 90), burned(wet, MAX), 'dopo 90 minuti non brucia più nulla');
  assert.ok(burned(wet, MAX) < 0.25 * burned(dry, 120), 'area molto minore di quella senza pioggia');
  const m = weather([0, 99]).at(120).moist.m1;
  assert.ok(m > 0.2, `combustibile fine bagnato dopo 2 h: ${m}`);
});

test('pioggia dopo 2 ore: le prime 2 ore sono identiche, poi il fronte si ferma entro circa un\'ora', () => {
  const dry = run(null), wet = run([2, 99]);
  for (let i = 0; i < dry.length; i++) if (dry[i] <= 120) assert.equal(wet[i], dry[i]);
  assert.equal(burned(wet, 120), burned(dry, 120));
  assert.ok(lastArrival(wet) <= 190, `ultimo arrivo a ${lastArrival(wet)} min`);
  assert.ok(burned(wet, MAX) < burned(dry, MAX));
});

test('limite dichiarato: con pioggia tra la 2ª e la 3ª ora il fronte si ferma e non riparte quando torna il secco', () => {
  const brief = run([2, 3]), long = run([2, 99]);
  const m = weather([2, 3]).at(MAX).moist.m1;
  assert.ok(m < 0.12, `a fine simulazione il combustibile fine è di nuovo secco: ${m}`);
  assert.equal(burned(brief, MAX), burned(long, MAX), 'stessa area che con la pioggia continua: nessuna ripresa');
});
