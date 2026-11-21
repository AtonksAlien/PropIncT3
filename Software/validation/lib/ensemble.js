// Insieme di simulazioni (DECISIONI D48): la stessa simulazione ripetuta facendo variare, entro la loro
// incertezza, i dati in ingresso meno sicuri: punto e ora dell'innesco, velocità e direzione del vento.
// Il risultato è la probabilità che ogni cella bruci (quota delle simulazioni che la bruciano, ad area
// uguale con l'osservato) e la distribuzione delle misure, invece di un solo perimetro.
// Funzione pura (niente file né rete): la usano validate.js e i test.

import { simulate } from '../../engine/simulate.js';
import { areaMatchedMask, confusion } from './metrics.js';
import { rng } from '../../experiments/lib/rng.js';

/** Meteo con il vento scalato di `speedFactor` e ruotato di `dirOffset` gradi; umidità invariata. */
export function perturbWeather(wx, speedFactor, dirOffset) {
  return {
    ...wx,
    at: (tMin) => {
      const w = wx.at(tMin);
      return { ...w, ws10: w.ws10 * speedFactor, gust: (w.gust ?? w.ws10) * speedFactor, from: (w.from + dirOffset + 360) % 360 };
    },
  };
}

const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : null; };

/**
 * @param o.grid, o.models, o.obsMask, o.maxMin, o.barriers, o.liveNdvi   come per evaluate()
 * @param o.makeWx(offsetMin)  meteo per un innesco spostato di offsetMin minuti dall'ora di riferimento
 * @param o.ignition   { r, c } di riferimento; o.snap(cell) → cella combustibile più vicina
 * @param o.members    numero di simulazioni (default 50); o.seed (default 2026)
 * @param o.radiusM    raggio dell'incertezza sul punto di innesco (m)
 * @param o.windowMin  [min, max] minuti di spostamento dell'ora di innesco
 * @param o.windPct    variazione massima della velocità del vento (frazione, es. 0,25)
 * @param o.windDeg    variazione massima della direzione del vento (gradi)
 * @param o.within     se vero (default) il punto di innesco si estrae solo dentro l'area osservata:
 *                     l'origine di un incendio sta per definizione dentro l'area che ha bruciato
 * @param o.onMember   (arrival, run) chiamata dopo ogni simulazione, facoltativa
 */
export function runEnsemble(o) {
  const { grid, models, obsMask, maxMin, barriers = true, liveNdvi = true, terrainWind = false, fuelNdvi = false, makeWx, ignition, snap,
    members = 50, seed = 2026, radiusM = 375, windowMin = [0, 0], windPct = 0.25, windDeg = 20, within = true, onMember = null, onProgress = () => {} } = o;
  const domain = new Uint8Array(grid.n);
  let K = 0;
  for (let i = 0; i < grid.n; i++) { domain[i] = grid.fuel[i] > 0 ? 1 : 0; if (obsMask[i] && domain[i]) K++; }
  const rand = rng(seed), count = new Uint16Array(grid.n), runs = [];
  for (let m = 0; m < members; m++) {
    // punto uniforme nel cerchio di raggio radiusM, ora uniforme nella finestra, vento uniforme negli intervalli
    // (con within: si ripete l'estrazione finché la cella cade dentro l'osservato, al massimo 200 volte)
    let ign;
    for (let k = 0; k < 200; k++) {
      const rho = radiusM * Math.sqrt(rand()), phi = 2 * Math.PI * rand();
      ign = snap({ r: Math.round(ignition.r - (rho * Math.cos(phi)) / grid.res), c: Math.round(ignition.c + (rho * Math.sin(phi)) / grid.res) });
      if (!within || obsMask[ign.r * grid.cols + ign.c]) break;
    }
    const offsetMin = windowMin[0] + rand() * (windowMin[1] - windowMin[0]);
    const speedFactor = 1 + windPct * (2 * rand() - 1), dirOffset = windDeg * (2 * rand() - 1);
    const wx = perturbWeather(makeWx(offsetMin), speedFactor, dirOffset);
    const r = simulate(grid, models, { ignitions: [ign], maxMin, barriers, liveNdvi, terrainWind, fuelNdvi }, wx);
    const am = areaMatchedMask(r.arrival, domain, K);
    for (let i = 0; i < grid.n; i++) if (am.mask[i]) count[i]++;
    const s = confusion(obsMask, am.mask, domain);
    runs.push({ ignition: ign, offsetMin, speedFactor, dirOffset, sorensen: s.sorensen, precision: s.precision, recall: s.recall, tMin: am.tMin });
    if (onMember) onMember(r.arrival, runs[m]);   // es. analisi temporale di ogni simulazione
    if ((m + 1) % 10 === 0) onProgress(`insieme: ${m + 1} di ${members}`);
  }
  const prob = new Float32Array(grid.n);
  for (let i = 0; i < grid.n; i++) prob[i] = count[i] / members;
  // consenso: celle bruciate in almeno metà delle simulazioni
  const consensus = new Uint8Array(grid.n);
  let obsHigh = 0;
  for (let i = 0; i < grid.n; i++) { consensus[i] = prob[i] >= 0.5 ? 1 : 0; if (obsMask[i] && domain[i] && prob[i] >= 0.5) obsHigh++; }
  const sor = runs.map((x) => x.sorensen);
  // probabilità media dentro e fuori dall'area osservata (quanto la mappa separa le due zone)
  let pIn = 0, nIn = 0, pOut = 0, nOut = 0;
  for (let i = 0; i < grid.n; i++) {
    if (!domain[i] || (prob[i] === 0 && !obsMask[i])) continue;   // fuori: solo celle bruciate almeno una volta
    if (obsMask[i]) { pIn += prob[i]; nIn++; } else { pOut += prob[i]; nOut++; }
  }
  return {
    members, settings: { radiusM, windowMin, windPct, windDeg, seed, within },
    runs, prob,
    summary: {
      sorensen: { median: quantile(sor, 0.5), q1: quantile(sor, 0.25), q3: quantile(sor, 0.75), min: Math.min(...sor), max: Math.max(...sor) },
      consensus: confusion(obsMask, consensus, domain),
      observedCoveredHalf: K ? obsHigh / K : null,
      meanProbInside: nIn ? pIn / nIn : null,
      meanProbOutsideBurnt: nOut ? pOut / nOut : null,
    },
  };
}
