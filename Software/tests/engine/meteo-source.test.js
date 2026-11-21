// Test del modulo condiviso browser/server per Open-Meteo: fonte, URL, giorni, controllo della serie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSource, simulationRequest, checkHourly, HOURLY } from '../../engine/meteo-source.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const series = (t0, n, over = {}) => ({ hourly: { time: Array.from({ length: n }, (_, i) => t0 + i * 3600),
  ...Object.fromEntries(HOURLY.map((k) => [k, Array(n).fill(1)])), ...over } });

test('fonte: archivio IFS dal 2017, ERA5 prima, ICON-2I per gli ultimi giorni, errore oltre la previsione', () => {
  assert.equal(chooseSource('2019-07-25', '2019-07-29', NOW).model, 'ecmwf_ifs');
  assert.equal(chooseSource('2010-07-25', '2010-07-29', NOW).model, 'era5');
  assert.equal(chooseSource('2026-11-17', '2026-11-21', NOW).model, 'italia_meteo_arpae_icon_2i');
  assert.throws(() => chooseSource('2026-11-20', '2026-11-25', NOW), /3 giorni/);
});

test('richiesta per una simulazione: 3 giorni prima dell\'innesco, unità e fuso nell\'URL', () => {
  const q = simulationRequest({ lat: 40.5274, lon: 9.6494 }, new Date('2019-07-28T19:05:00Z'), 1440, NOW);
  assert.equal(q.start, '2019-07-25'); assert.equal(q.end, '2019-07-29');
  assert.match(q.url, /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
  for (const p of ['latitude=40.5274', 'wind_speed_unit=ms', 'timezone=GMT', 'timeformat=unixtime', 'models=ecmwf_ifs']) assert.ok(q.url.includes(p), p);
});

test('controllo della serie: valida, variabile mancante, valori non numerici, copertura insufficiente', () => {
  const start = new Date('2019-07-28T19:00:00Z'), t0 = start.getTime() / 1000 - 3 * 86400;
  assert.ok(checkHourly(series(t0, 5 * 24), { start, durMin: 600 }));
  assert.throws(() => checkHourly(series(t0, 120, { precipitation: undefined })), /mancanti/);
  assert.throws(() => checkHourly(series(t0, 120, { wind_speed_10m: Array(120).fill('6') })), /non numerici/);
  assert.throws(() => checkHourly(series(t0, 72), { start, durMin: 600 }), /non copre/);
  assert.throws(() => checkHourly({}), /assente/);
});
