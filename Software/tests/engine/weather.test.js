// Test del meteo: interpolazione, umidità del combustibile, scelta della fonte e cache (senza rete).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHourly, weatherAt, emcSimard, deadFuelMoisture, liveScenarioFor } from '../../engine/weather.js';
import { chooseSource, fetchHourly } from '../../backend/src/weather/openmeteo.js';

const T0 = Date.UTC(2023, 6, 25, 0) / 1000;

/** Risposta Open-Meteo finta: n ore con valori costanti, sovrascrivibili. */
function fakeJson(n, over = {}) {
  const fill = (v) => Array.from({ length: n }, (_, i) => (typeof v === 'function' ? v(i) : v));
  return {
    hourly: {
      time: fill((i) => T0 + i * 3600),
      temperature_2m: fill(over.temp ?? 30), relative_humidity_2m: fill(over.rh ?? 30),
      wind_speed_10m: fill(over.ws ?? 5), wind_direction_10m: fill(over.wd ?? 270),
      wind_gusts_10m: fill(10), precipitation: fill(over.precip ?? 0),
    },
  };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('meteo: interpolazione lineare a metà ora', () => {
  const s = parseHourly(fakeJson(3, { temp: (i) => 20 + 10 * i, ws: (i) => 2 * i }));
  const w = weatherAt(s, T0 + 1800);
  near(w.temp, 25, 1e-4); near(w.windSpeed, 1, 1e-4);
  near(weatherAt(s, T0 - 999).temp, 20, 1e-4, 'prima della serie');
  near(weatherAt(s, T0 + 99999).temp, 40, 1e-4, 'dopo la serie');
});

test('meteo: la direzione si interpola sul cerchio (350° → 10° passa da 0°, non da 180°)', () => {
  const s = parseHourly(fakeJson(2, { wd: (i) => (i ? 10 : 350) }));
  const d = weatherAt(s, T0 + 1800).windFrom;
  assert.ok(d < 0.5 || d > 359.5, `direzione ${d}`);
});

test('EMC di Simard: valore di riferimento e andamento', () => {
  // 70 °F, 50% → 21,0606 + 0,005565·2500 − 0,00035·50·70 − 0,483199·50 = 9,59%
  near(emcSimard((70 - 32) * 5 / 9, 50), 0.0959, 5e-4);
  assert.ok(emcSimard(30, 20) < emcSimard(30, 60), 'più umidità dell\'aria → combustibile più umido');
  assert.ok(emcSimard(40, 30) < emcSimard(15, 30), 'più caldo → combustibile più secco');
});

test('umidità morta: in condizioni costanti resta all\'equilibrio', () => {
  const s = parseHourly(fakeJson(48));
  const m = deadFuelMoisture(s), emc = emcSimard(30, 30);
  for (const k of ['m1', 'm10', 'm100']) near(m[k][47], emc, 1e-6, k);
});

test('umidità morta: risposta con costante di tempo 1h, 10h, 100h', () => {
  // gradino di umidità dell'aria all'ora 1: dopo un'ora la classe 1h ha coperto il 63% del salto
  const s = parseHourly(fakeJson(3, { rh: (i) => (i === 0 ? 20 : 80) }));
  const m = deadFuelMoisture(s);
  const a = emcSimard(30, 20), b = emcSimard(30, 80);
  near((m.m1[1] - a) / (b - a), 1 - Math.exp(-1), 1e-5, '1h');
  near((m.m10[1] - a) / (b - a), 1 - Math.exp(-0.1), 1e-5, '10h');
  near((m.m100[1] - a) / (b - a), 1 - Math.exp(-0.01), 1e-5, '100h');
});

test('umidità morta: la pioggia inumidisce il combustibile fine', () => {
  const dry = deadFuelMoisture(parseHourly(fakeJson(6)));
  const wet = deadFuelMoisture(parseHourly(fakeJson(6, { precip: (i) => (i === 3 ? 2 : 0) })));
  assert.ok(wet.m1[3] > 3 * dry.m1[3], `pioggia: ${wet.m1[3]} vs ${dry.m1[3]}`);
});

test('umidità viva: scenario per mese', () => {
  assert.equal(liveScenarioFor(new Date('2023-07-25')), 'L1');
  assert.equal(liveScenarioFor(new Date('2023-06-10')), 'L2');
  assert.equal(liveScenarioFor(new Date('2023-03-10')), 'L3');
});

test('Open-Meteo: fonte scelta in base alla data', () => {
  const now = new Date('2026-11-09T12:00Z');
  assert.deepEqual(
    [chooseSource('2023-07-22', '2023-07-25', now).model, chooseSource('2010-07-22', '2010-07-25', now).model],
    ['ecmwf_ifs', 'era5']);
  assert.equal(chooseSource('2026-11-08', '2026-11-10', now).model, 'italia_meteo_arpae_icon_2i');
  assert.throws(() => chooseSource('2026-11-20', '2026-11-21', now));
});

test('Open-Meteo: la seconda richiesta uguale arriva dalla cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'propinc-meteo-'));
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => fakeJson(24) }; };
  const opts = { cacheDir: dir, fetchImpl, now: new Date('2026-11-09T12:00Z') };
  try {
    const a = await fetchHourly({ lat: 40.8818, lon: 16.6854 }, '2023-07-22', '2023-07-25', opts);
    const b = await fetchHourly({ lat: 40.8818, lon: 16.6854 }, '2023-07-22', '2023-07-25', opts);
    assert.equal(calls, 1);
    assert.equal(a.fromCache, false); assert.equal(b.fromCache, true);
    assert.deepEqual(b.json, a.json);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Open-Meteo: errore chiaro se mancano variabili', async () => {
  const bad = fakeJson(24); bad.hourly.wind_gusts_10m = bad.hourly.wind_gusts_10m.map(() => null);
  const fetchImpl = async () => ({ ok: true, json: async () => bad });
  await assert.rejects(fetchHourly({ lat: 40.88, lon: 16.68 }, '2023-07-22', '2023-07-25',
    { fetchImpl, now: new Date('2026-11-09T12:00Z') }), /wind_gusts_10m/);
});

test('strato limite orario: interpolato nel tempo e passato al vento', async () => {
  const { makeWeather } = await import('../../engine/simulate.js');
  const t0 = Date.UTC(2019, 6, 28, 20) / 1000;
  const blhJson = { hourly: { time: [t0 - 3600, t0, t0 + 3600], boundary_layer_height: [1200, 1000, 800] } };
  const wx = makeWeather({ wind: { speed: 5, from: 270 }, start: new Date(t0 * 1000), blhJson });
  assert.equal(wx.at(0).blh, 1000);
  assert.equal(wx.at(30).blh, 900);
  assert.equal(makeWeather({ wind: { speed: 5, from: 270 } }).at(0).blh, undefined);
});
