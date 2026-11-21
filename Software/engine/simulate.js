// Una simulazione completa, indipendente da chi la chiede (CLI, worker del server, test).
// Riceve griglia, modelli di combustibile, inneschi e meteo già scaricato; ritorna il tempo di arrivo.

import { runMTT } from './mtt.js';
import { spreadField, LazyField } from './spreadfield.js';
import { withBarriers } from './grid.js';
import { withNdviFuel } from './fuelndvi.js';
import { parseHourly, weatherAt, deadFuelMoisture, moistureAt, liveScenarioFor, LIVE_SCENARIOS } from './weather.js';

// Umidità senza meteo reale: scenario D2L2 di Scott & Burgan (2005), "bassa umidità" (6/7/8% morti, 60/90% vivi).
export const DEFAULT_MOIST = { m1: 0.06, m10: 0.07, m100: 0.08, herb: 0.60, woody: 0.90 };
export const FIELD_STEP_MIN = 10;   // il campo di Rothermel si ricalcola ogni 10 minuti simulati

/**
 * Meteo per il modello.
 * - con `hourlyJson` (risposta Open-Meteo) e `start` (Date): vento e umidità reali, variabili nel tempo;
 * - altrimenti vento costante `wind` = { speed, from } e umidità DEFAULT_MOIST.
 * @returns { at(minuto) → { ws10, from, moist }, hourly: riepilogo orario }
 */
export function makeWeather({ hourlyJson = null, start = null, wind = { speed: 0, from: 0 }, durMin = 180, blhJson = null, moist = null }) {
  // altezza dello strato limite oraria (ERA5, D53), interpolata nel tempo; null se non disponibile
  const blhAt = blhJson && start ? blhSeries(blhJson, start.getTime() / 1000) : () => undefined;
  if (!hourlyJson) {
    return {
      // moist: umidità costanti (es. le stesse date a FlamMap); senza, quelle di default
      at: (tMin) => ({ ws10: wind.speed, from: wind.from, gust: wind.gust ?? wind.speed, moist: moist ?? DEFAULT_MOIST, blh: blhAt(tMin) }),
      hourly: [], live: null, source: 'costante',
    };
  }
  const s = parseHourly(hourlyJson), dead = deadFuelMoisture(s);
  const t0 = start.getTime() / 1000;
  const liveName = liveScenarioFor(start), live = LIVE_SCENARIOS[liveName];
  const at = (tMin) => {
    const w = weatherAt(s, t0 + tMin * 60);
    return { ws10: w.windSpeed, from: w.windFrom, gust: Math.max(w.gust, w.windSpeed), moist: { ...moistureAt(s, dead, t0 + tMin * 60), ...live }, blh: blhAt(tMin), w };
  };
  const hourly = [];
  for (let m = 0; m <= durMin; m += 60) {
    const { w, moist } = at(m);
    hourly.push({ t: new Date((t0 + m * 60) * 1000).toISOString(), temp: w.temp, rh: w.rh, windSpeed: w.windSpeed,
      windFrom: w.windFrom, gust: w.gust, m1: moist.m1, m10: moist.m10, m100: moist.m100 });
  }
  return { at, hourly, live: liveName, source: 'open-meteo' };
}

/** Interpolazione lineare della serie ERA5 { hourly: { time (s), boundary_layer_height } } al minuto t. */
function blhSeries(json, t0) {
  const t = json.hourly.time, v = json.hourly.boundary_layer_height;
  return (tMin) => {
    const x = t0 + tMin * 60;
    if (x <= t[0]) return v[0] ?? undefined;
    for (let k = 0; k < t.length - 1; k++) {
      if (x <= t[k + 1]) {
        const a = v[k], b = v[k + 1];
        if (a === null || b === null) return a ?? b ?? undefined;
        return a + ((b - a) * (x - t[k])) / (t[k + 1] - t[k]);
      }
    }
    return v[v.length - 1] ?? undefined;
  };
}

/**
 * Simulazione con il modello di Rothermel e il tempo minimo di arrivo (Dijkstra su 16 direzioni).
 * @param job { ignitions: [{r,c}], maxMin, barriers? }
 *            barriers: true (default) = barriere OSM attraversabili secondo la lunghezza di fiamma (D46),
 *            'assolute' = ogni barriera ferma il fuoco, false = nessuna barriera
 *            liveNdvi (default true): umidità viva per cella dall'NDVI (D47); false = scenario del mese ovunque
 *            fuelNdvi (default false): combustibile CORINE corretto a 10 m dall'NDVI estivo (D54)
 *            terrainWind (default false): vento corretto dal rilievo, MicroMet (D52); true o { etaM, ... }
 * @returns { arrival (Float32Array, minuti), burnedHa, ms, fields, cellsComputed, fieldBytes }
 */
export function simulate(baseGrid, models, job, weather) {
  const { ignitions, maxMin } = job;
  const fuelGrid = job.fuelNdvi ? withNdviFuel(baseGrid) : baseGrid;   // dettaglio del combustibile dall'NDVI (D54)
  const grid = job.barriers === false ? fuelGrid : withBarriers(fuelGrid, { absolute: job.barriers === 'assolute' });
  const lazy = lazyFieldAt(grid, models, weather, { liveNdvi: job.liveNdvi !== false, terrainWind: job.terrainWind ?? false });
  const r = runMTT(grid, ignitions, lazy.fieldAt, { maxMin });
  return { ...r, fields: lazy.steps(), cellsComputed: lazy.field.computed, fieldBytes: lazy.field.bytes };
}

/**
 * Campo di Rothermel su richiesta: un LazyField riusato, che cambia istante ogni
 * FIELD_STEP_MIN minuti. Dijkstra chiede istanti non decrescenti, quindi basta l'istante corrente;
 * se un istante precedente venisse richiesto (nuova simulazione), il campo si ricalcola comunque giusto.
 */
export function lazyFieldAt(grid, models, weather, opts = {}) {
  const field = new LazyField(grid, models, opts);
  let k = -1, steps = 0;
  const constant = weather.source === 'costante';   // meteo fisso: un solo istante, ogni cella calcolata una volta
  const fieldAt = (tMin) => {
    const kk = constant ? 0 : Math.floor(tMin / FIELD_STEP_MIN);
    if (kk !== k) {
      const { ws10, from, gust, moist, blh } = weather.at(kk * FIELD_STEP_MIN);
      field.setStep(moist, { ws10, from, gust, blh });
      k = kk; steps++;
    }
    return field;
  };
  return { fieldAt, field, steps: () => steps };
}

/** Campo completo all'istante tMin (per mappe e interfaccia). */
export function fullFieldAt(grid, models, weather, tMin = 0) {
  const { ws10, from, moist } = weather.at(tMin);
  return spreadField(grid, models, moist, { ws10, from });
}

/** Area bruciata (ha) entro ogni ora. */
export function burnedByHour(grid, arrival, maxMin) {
  const out = [];
  for (let h = 1; h <= Math.ceil(maxMin / 60); h++) {
    let k = 0;
    for (const t of arrival) if (t <= h * 60) k++;
    out.push((k * grid.res * grid.res) / 1e4);
  }
  return out;
}

/**
 * Confronto tra due mappe di tempo di arrivo (es. con e senza barriere) entro il minuto t.
 * Sørensen = 2·|A∩B| / (|A| + |B|), Jaccard = |A∩B| / |A∪B|: 1 = stesse celle bruciate, 0 = nessuna in comune.
 * @returns conteggi di celle e indici
 */
export function compareArrivals(a, b, t = Infinity) {
  let both = 0, onlyA = 0, onlyB = 0;
  for (let i = 0; i < a.length; i++) {
    // Infinity = non raggiunta: va esclusa esplicitamente, perché Infinity <= Infinity è vero
    const inA = a[i] <= t && a[i] !== Infinity, inB = b[i] <= t && b[i] !== Infinity;
    if (inA && inB) both++; else if (inA) onlyA++; else if (inB) onlyB++;
  }
  const union = both + onlyA + onlyB;
  return { both, onlyA, onlyB, sorensen: union ? (2 * both) / (2 * both + onlyA + onlyB) : 1, jaccard: union ? both / union : 1 };
}
