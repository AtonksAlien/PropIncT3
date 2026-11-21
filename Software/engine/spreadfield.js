// Campo di propagazione sulla griglia: Rothermel in ogni cella, per un istante (vento e umidità dati).
// È l'ingresso del modello C (giorno 6): velocità massima, direzione e vento efficace per cella.
//
// Due versioni con gli stessi numeri (stessa funzione per cella):
//  - spreadField: tutta la griglia subito (mappe, interfaccia, esperimenti con molti inneschi);
//  - LazyField:   una cella solo quando serve (giorno 11, PROBLEMI P16). Il modello C visita solo le celle
//                 vicine al fuoco; calcolare tutta la griglia ogni 10 minuti era il 97% del tempo e, tenendo
//                 18 campi in memoria, 104 MB a 600² (circa 1,2 GB a 2000²).

import { fuelbed, spread, windAdjustmentFactor, midflameFtMin, FT_TO_M } from './rothermel.js';
import { lengthToWidth, eccentricity } from './ellipse.js';
import { terrainWindFor } from './terrainwind.js';
import { massWindFor } from './masswind.js';
import { windFieldFor } from './windfield.js';

/**
 * Copertura delle chiome per il fattore di riduzione del vento (Albini & Baughman 1979).
 * Solo i modelli di lettiera di bosco (8, 9, 10) sono sotto chioma. Valori assunti per la pineta di
 * rimboschimento di Mercadante (pino d'Aleppo, 10–15 m): copertura 50%, altezza 12 m, crown ratio 0,5.
 * Assunzione dichiarata, da sottoporre ad analisi di sensibilità.
 */
export const CANOPY = { cover: 0.5, heightM: 12, crownRatio: 0.5, models: [8, 9, 10] };

const BTU_FT2_TO_KJ_M2 = 11.3565;

/**
 * Umidità viva dall'NDVI (DECISIONI D47). Indice di verde relativo per combustibile: l'NDVI della cella
 * tra il 5° e il 95° percentile delle celle dello stesso modello nella zona, diviso in LIVE_BINS classi.
 * L'umidità viva va dallo scenario del mese (classe 0, la più secca) a quello più verde di un passo di
 * Scott & Burgan (classe LIVE_BINS−1): +30 punti per erbacee e legnose. Adattamento spaziale del metodo a
 * indice relativo di García et al. (2020), che usa il minimo e il massimo stagionali (qui una sola immagine).
 */
export const LIVE_BINS = 5;
const LIVE_STEP = { herb: 0.30, woody: 0.30 };

/** Classe di verde (0 … LIVE_BINS−1) per cella; calcolata una volta per griglia e tenuta in cache. */
export function liveBins(grid) {
  if (grid._liveBin) return grid._liveBin;
  const bin = new Uint8Array(grid.n);
  if (grid.ndvi) {
    const byModel = new Map();
    for (let i = 0; i < grid.n; i++) {
      const k = grid.fuel[i], v = grid.ndvi[i];
      if (k > 0 && Number.isFinite(v)) (byModel.get(k) ?? byModel.set(k, []).get(k)).push(v);
    }
    const lim = new Map();
    for (const [k, vals] of byModel) {
      vals.sort((a, b) => a - b);
      lim.set(k, [vals[Math.floor(0.05 * (vals.length - 1))], vals[Math.floor(0.95 * (vals.length - 1))]]);
    }
    for (let i = 0; i < grid.n; i++) {
      const l = lim.get(grid.fuel[i]);
      if (!l || !(l[1] > l[0])) continue;
      const x = (grid.ndvi[i] - l[0]) / (l[1] - l[0]);
      bin[i] = Math.max(0, Math.min(LIVE_BINS - 1, Math.round(x * (LIVE_BINS - 1))));
    }
  }
  Object.defineProperty(grid, '_liveBin', { value: bin, enumerable: false });
  return bin;
}
   // 1 BTU/ft² = 1,055056 kJ / 0,09290304 m²

/**
 * Calore liberato per unità di area del fronte (kJ/m²) nella cella i: H_A = I_R · t_r, con il tempo di
 * residenza della fiamma t_r = 384/σ minuti (Anderson 1969, come in Behave). Moltiplicato per la velocità
 * dà l'intensità del fronte di Byram (kW/m), da cui la lunghezza di fiamma.
 */
function bedOf(grid, pm, i) {
  const k = grid.fuel[i];
  return pm.bedsLive && pm.bedsLive[k] ? pm.bedsLive[k][grid._liveBin[i]] : pm.beds[k];
}

function heatPerAreaOf(grid, pm, i) {
  const fb = bedOf(grid, pm, i);
  return fb && fb.sigma > 0 ? fb.IR * (384 / fb.sigma) * BTU_FT2_TO_KJ_M2 : 0;
}

/** Lunghezza di fiamma (m) dall'intensità del fronte I (kW/m), Byram (1959): L = 0,0775 · I^0,46. */
export const flameLength = (intensityKWm) => (intensityKWm > 0 ? 0.0775 * intensityKWm ** 0.46 : 0);

/**
 * Lunghezza di fiamma (m) nella cella i lungo l'azimut az con il vento di raffica: serve solo a decidere
 * se il fronte salta una barriera (engine/mtt.js), perché l'attraversamento avviene nei picchi di
 * intensità. La velocità di propagazione resta quella del vento medio, come in Rothermel e in Behave.
 */
function gustFlameOf(grid, pm, i, az, windLimit) {
  const k = grid.fuel[i], fb = bedOf(grid, pm, i);
  if (!fb || !(fb.sigma > 0)) return 0;
  const tw = pm.tw, gust = tw ? pm.gust * tw.factor(i) : pm.gust, to = tw ? (tw.from(i) + 180) % 360 : pm.windTo;
  const r = spread(fb, midflameFtMin(gust, pm.waf[k]), to, grid.tanSlope[i], grid.aspect[i], { windLimit });
  const ros = r.ros * FT_TO_M, e = eccentricity(lengthToWidth(r.effWind * FT_TO_M));
  const rAz = (ros * (1 - e)) / (1 - e * Math.cos(((az - r.dir) * Math.PI) / 180));
  return flameLength((heatPerAreaOf(grid, pm, i) * rAz) / 60);
}

/**
 * Grandezze che dipendono solo da combustibile e meteo: una volta per modello e per istante.
 * Con `liveNdvi` anche una versione del letto per ogni classe di verde (bedsLive[k][b]).
 */
function perModel(models, moist, wind, canopy, liveNdvi = false, grid = null, terrainWind = false) {
  const beds = [], waf = [], mid = [], bedsLive = liveNdvi ? [] : null;
  for (let k = 1; k < models.length; k++) {
    if (!models[k]) continue;
    beds[k] = fuelbed(models[k].us, moist);
    if (bedsLive) {
      bedsLive[k] = [beds[k]];
      for (let b = 1; b < LIVE_BINS; b++) {
        const f = b / (LIVE_BINS - 1);
        bedsLive[k][b] = fuelbed(models[k].us, { ...moist, herb: moist.herb + f * LIVE_STEP.herb, woody: moist.woody + f * LIVE_STEP.woody });
      }
    }
    waf[k] = canopy.models.includes(k)
      ? windAdjustmentFactor(models[k].us.depth, canopy.cover, canopy.heightM / FT_TO_M, canopy.crownRatio)
      : windAdjustmentFactor(models[k].us.depth);
    mid[k] = midflameFtMin(wind.ws10, waf[k]);
  }
  // vento corretto dal rilievo (D52): fattore di velocità e direzione per cella, calcolati su richiesta
  // terrainWind: true o { etaM } = MicroMet (D52); { method: 'massa', blhM } = conservazione della massa (D53),
  // con l'altezza dello strato limite dal meteo (wind.blh) se c'è, altrimenti blhM
  const tw = !terrainWind || !grid ? null
    : terrainWind.method === 'campo' ? windFieldFor(terrainWind.runs, wind.from)   // campo esterno (WindNinja)
    : terrainWind.method === 'massa' ? massWindFor(grid, wind.from, wind.blh ?? (Number.isFinite(terrainWind.blhM) ? terrainWind.blhM : 1000), terrainWind)
      : terrainWindFor(grid, wind.from, terrainWind === true ? {} : terrainWind);
  return { beds, bedsLive, waf, mid, windTo: (wind.from + 180) % 360, gust: wind.gust ?? wind.ws10, ws10: wind.ws10, tw };
}

/** Calcolo per una cella, condiviso dalle due versioni (risultati identici bit per bit). */
function fillCell(f, grid, pm, i, windLimit) {
  const k = grid.fuel[i];
  if (!pm.beds[k]) { f.ros[i] = 0; f.dir[i] = 0; f.effWind[i] = 0; f.ecc[i] = 0; return; }
  const tw = pm.tw;
  const mid = tw ? midflameFtMin(pm.ws10 * tw.factor(i), pm.waf[k]) : pm.mid[k];
  const r = spread(bedOf(grid, pm, i), mid, tw ? (tw.from(i) + 180) % 360 : pm.windTo, grid.tanSlope[i], grid.aspect[i], { windLimit });
  f.ros[i] = r.ros * FT_TO_M; f.dir[i] = r.dir; f.effWind[i] = r.effWind * FT_TO_M;
  f.ecc[i] = eccentricity(lengthToWidth(f.effWind[i]));
}

/**
 * @param grid    griglia (fuel, tanSlope, aspect)
 * @param models  da parseFuelModels (si usa .us)
 * @param moist   { m1, m10, m100, herb, woody } frazioni
 * @param wind    { ws10 (m/s a 10 m), from (gradi, convenzione meteo) }
 * @param terrainWind  false, true o { etaM, slopeWeight, curvWeight }: vento corretto dal rilievo (D52)
 * @returns { ros (m/min), dir (gradi da Nord), effWind (m/min), ecc (eccentricità dell'ellisse), waf e beds per modello }
 */
export function spreadField(grid, models, moist, wind, { canopy = CANOPY, windLimit = false, liveNdvi = false, terrainWind = false } = {}) {
  const { n } = grid;
  const f = { ros: new Float32Array(n), dir: new Float32Array(n), effWind: new Float32Array(n), ecc: new Float32Array(n) };
  if (liveNdvi) liveBins(grid);
  const pm = perModel(models, moist, wind, canopy, liveNdvi, grid, terrainWind);
  for (let i = 0; i < n; i++) if (pm.beds[grid.fuel[i]]) fillCell(f, grid, pm, i, windLimit);
  return { ...f, waf: pm.waf, beds: pm.beds, ws10: wind.ws10, gust: pm.gust,
    heatPerArea: (i) => heatPerAreaOf(grid, pm, i), gustFlame: (i, az) => gustFlameOf(grid, pm, i, az, windLimit) };
}

/**
 * Campo calcolato su richiesta: `ensure(i)` riempie la cella i se non è già calcolata per l'istante corrente.
 * Un solo insieme di array per tutta la simulazione; `setStep` cambia istante invalidando le celle in O(1)
 * (un contatore per cella invece di azzerare gli array).
 */
export class LazyField {
  constructor(grid, models, { canopy = CANOPY, windLimit = false, liveNdvi = false, terrainWind = false } = {}) {
    const { n } = grid;
    this.grid = grid; this.models = models; this.canopy = canopy; this.windLimit = windLimit; this.liveNdvi = liveNdvi;
    this.terrainWind = terrainWind;
    if (liveNdvi) liveBins(grid);
    this.ros = new Float32Array(n); this.dir = new Float32Array(n);
    this.effWind = new Float32Array(n); this.ecc = new Float32Array(n);
    this.stamp = new Uint32Array(n);   // istante per cui la cella è valida (0 = mai)
    this.cur = 0; this.computed = 0;
  }

  setStep(moist, wind) {
    this.pm = perModel(this.models, moist, wind, this.canopy, this.liveNdvi, this.grid, this.terrainWind);
    this.ws10 = wind.ws10; this.gust = this.pm.gust;
    this.waf = this.pm.waf; this.beds = this.pm.beds;
    this.cur++;
    return this;
  }

  ensure(i) {
    if (this.stamp[i] === this.cur) return;
    this.stamp[i] = this.cur;
    this.computed++;
    fillCell(this, this.grid, this.pm, i, this.windLimit);
  }

  /** Calore per unità di area (kJ/m²) della cella i all'istante corrente. */
  heatPerArea(i) { return heatPerAreaOf(this.grid, this.pm, i); }

  /** Lunghezza di fiamma con il vento di raffica lungo l'azimut az (per il salto delle barriere). */
  gustFlame(i, az) { return gustFlameOf(this.grid, this.pm, i, az, this.windLimit); }

  /** Byte occupati dagli array del campo. */
  get bytes() { return this.ros.byteLength * 5; }
}
