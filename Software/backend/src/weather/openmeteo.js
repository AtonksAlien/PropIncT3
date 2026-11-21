// Client Open-Meteo (senza chiave) con cache su disco. Solo Node (usa fs); il motore riceve la serie già pronta.
//
// Fonte in base alle date (engine/meteo-source.js): archivio ECMWF IFS/ERA5 oltre 7 giorni fa, ICON-2I per
// gli ultimi giorni e i prossimi 2. Nell'interfaccia il meteo lo scarica di norma il browser; il server lo
// scarica solo per la validazione, la riga di comando e quando il browser non ci riesce.
//
// Cache: un file JSON per richiesta in data/zones/<zona>/raw/meteo/. I dati d'archivio non cambiano e
// restano validi per sempre; quelli di previsione scadono dopo un'ora.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Scelta della fonte, URL e controllo della serie stanno in engine/meteo-source.js, condiviso con il browser.
import { HOURLY, chooseSource, buildUrl, simulationDays, checkHourly } from '../../../engine/meteo-source.js';
export { HOURLY, chooseSource, buildUrl, checkHourly };

const FORECAST_TTL_MS = 3600e3;

/**
 * Serie oraria per un punto e un intervallo di giorni (estremi inclusi).
 * @returns {Promise<{source, model, url, fromCache, json}>}
 */
export async function fetchHourly(point, start, end, { cacheDir, now = new Date(), fetchImpl = fetch } = {}) {
  const src = chooseSource(start, end, now);
  const url = buildUrl(point, start, end, src);
  const file = cacheDir && join(cacheDir, `${src.model}_${start}_${end}_${point.lat.toFixed(4)}_${point.lon.toFixed(4)}.json`);

  if (file && existsSync(file)) {
    const fresh = src.kind === 'archivio' || now.getTime() - statSync(file).mtimeMs < FORECAST_TTL_MS;
    if (fresh) return { source: src.kind, model: src.model, url, fromCache: true, json: JSON.parse(readFileSync(file, 'utf8')) };
  }

  const res = await fetchImpl(url);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Open-Meteo: ${json.reason ?? res.status}`);
  try { checkHourly(json); } catch (err) { throw new Error(`Open-Meteo: ${err.message} per ${src.model}`); }

  if (file) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(json));
  }
  return { source: src.kind, model: src.model, url, fromCache: false, json };
}

/**
 * Serie per una simulazione che parte a `start` (Date) e dura `durMin` minuti: si chiedono anche i 3 giorni
 * precedenti, che servono a portare in equilibrio l'umidità del combustibile morto (engine/weather.js).
 */
export function fetchForSimulation(point, start, durMin, opts = {}) {
  const d = simulationDays(start, durMin);
  return fetchHourly(point, d.start, d.end, opts);
}

/**
 * Altezza dello strato limite (m) oraria da ERA5 (DECISIONI D53): serve al vento a conservazione della
 * massa. IFS nell'archivio di Open-Meteo non la fornisce, ERA5 sì (25 km, dal 1940). Cache come sopra.
 * Stessi giorni di fetchForSimulation.
 * @returns {Promise<{model, url, fromCache, json}>}  json.hourly.time (secondi Unix) e boundary_layer_height
 */
export async function fetchBoundaryLayer(point, start, durMin, { cacheDir, fetchImpl = fetch } = {}) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const s = day(start.getTime() - 86400e3), e = day(start.getTime() + durMin * 60e3);
  const q = new URLSearchParams({
    latitude: point.lat.toFixed(4), longitude: point.lon.toFixed(4), start_date: s, end_date: e,
    hourly: 'boundary_layer_height', models: 'era5', timezone: 'GMT', timeformat: 'unixtime',
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${q}`;
  const file = cacheDir && join(cacheDir, `era5_blh_${s}_${e}_${point.lat.toFixed(4)}_${point.lon.toFixed(4)}.json`);
  if (file && existsSync(file)) return { model: 'era5', url, fromCache: true, json: JSON.parse(readFileSync(file, 'utf8')) };
  const res = await fetchImpl(url);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Open-Meteo (strato limite): ${json.reason ?? res.status}`);
  if (!json.hourly?.boundary_layer_height?.some((v) => v !== null)) throw new Error('Open-Meteo: altezza dello strato limite mancante');
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(json)); }
  return { model: 'era5', url, fromCache: false, json };
}
