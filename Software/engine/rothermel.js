// Modello di Rothermel (1972) con le modifiche di Albini (1976): velocità del fronte di fiamma superficiale.
//
// Le equazioni sono scritte nelle unità originali (lb, ft, BTU, minuti): così ogni coefficiente
// (3,348 · 0,8189 · 133 · 0,7913 · 7,47 · 5,275 …) si confronta direttamente con la fonte.
// Si converte in SI solo in ingresso (vento) e in uscita (velocità in m/min).
//
// Organizzazione del calcolo, uguale a Behave/BehavePlus (Andrews 2018, RMRS-GTR-371):
//  1. fuelbed(modello, umidità)  → grandezze che dipendono solo da combustibile e umidità:
//     intensità di reazione I_R, velocità senza vento e senza pendenza R0, coefficienti del vento.
//     Con umidità uniforme sulla zona bastano pochi letti (uno per modello): si calcolano una volta.
//  2. spread(letto, vento a metà fiamma, pendenza) → velocità e direzione di massima propagazione,
//     sommando come vettori l'effetto del vento e quello della pendenza (Rothermel 1983).
// Riferimento numerico: libreria Behave del US Forest Service (tests/engine/rothermel.test.js).

const RHO_P = 32;        // densità delle particelle, lb/ft³
const S_T = 0.0555;      // contenuto minerale totale
const S_E = 0.010;       // contenuto minerale effettivo
const HEAT = 8000;       // potere calorifico, BTU/lb
const SAV_10H = 109, SAV_100H = 30;   // 1/ft

export const FT_TO_M = 0.3048;
const RAD = Math.PI / 180;

/**
 * Letto di combustibile.
 * @param m modello in unità originali: { depth (ft), mxDead (frazione), w1, w10, w100, wHerb, wWoody (lb/ft²),
 *          sav1, savHerb, savWoody (1/ft), dynamic (bool) }
 * @param moist umidità (frazioni): { m1, m10, m100, herb, woody }
 */
export function fuelbed(m, moist) {
  let wHerbLive = m.wHerb, wHerbDead = 0;
  if (m.dynamic && m.wHerb > 0) {
    // Modelli dinamici (Scott & Burgan 2005): l'erba si secca e passa ai morti con l'umidità viva.
    // Coefficienti come in BehavePlus: tutta morta sotto il 30%, tutta viva sopra il 120%.
    const frac = moist.herb < 0.30 ? 1 : moist.herb <= 1.20 ? 1.333 - 1.11 * moist.herb : 0;
    wHerbDead = m.wHerb * frac; wHerbLive = m.wHerb - wHerbDead;
  }
  const dead = [
    { w: m.w1, s: m.sav1, M: moist.m1 }, { w: m.w10, s: SAV_10H, M: moist.m10 },
    { w: m.w100, s: SAV_100H, M: moist.m100 }, { w: wHerbDead, s: m.savHerb, M: moist.m1 },
  ];
  const live = [{ w: wHerbLive, s: m.savHerb, M: moist.herb }, { w: m.wWoody, s: m.savWoody, M: moist.woody }];

  const cat = [dead, live].map(summarize);
  const [D, L] = cat;
  const aTot = D.area + L.area;
  if (aTot <= 0 || m.depth <= 0) return null;   // non combustibile
  D.frac = D.area / aTot; L.frac = L.area / aTot;

  const sigma = D.frac * D.sigma + L.frac * L.sigma;                    // SAV caratteristico, 1/ft
  const wTot = D.load + L.load;
  const rhoB = wTot / m.depth;                                          // densità apparente, lb/ft³
  const beta = wTot / (m.depth * RHO_P);                                // rapporto di impaccamento
  const betaRel = beta / (3.348 * sigma ** -0.8189);                    // β / β_op (eq. 37)

  // Umidità di estinzione: data per i morti; per i vivi dalla formula di Albini (1976, p. 89).
  const mxDead = m.mxDead;
  let mxLive = mxDead;
  if (L.load > 0) {
    let fineDead = 0, fineDeadM = 0, fineLive = 0;
    for (const p of dead) if (p.s > 0) { const e = p.w * Math.exp(-138 / p.s); fineDead += e; fineDeadM += e * p.M; }
    for (const p of live) if (p.s > 0) fineLive += p.w * Math.exp(-500 / p.s);
    const mfDead = fineDead > 0 ? fineDeadM / fineDead : 0;
    const ratio = fineLive > 0 ? fineDead / fineLive : 0;
    mxLive = Math.max(2.9 * ratio * (1 - mfDead / mxDead) - 0.226, mxDead);
  }
  D.mx = mxDead; L.mx = mxLive;

  // Intensità di reazione (eq. 27) con lo smorzamento per umidità (η_M) e minerali (η_S).
  const A = 133 * sigma ** -0.7913;
  const gMax = sigma ** 1.5 / (495 + 0.0594 * sigma ** 1.5);
  const gamma = gMax * betaRel ** A * Math.exp(A * (1 - betaRel));      // velocità di reazione, 1/min
  const etaS = Math.min(0.174 * S_E ** -0.19, 1);
  let IR = 0;
  for (const c of cat) {
    if (c.area <= 0) continue;
    const r = c.M / c.mx;
    const etaM = r >= 1 ? 0 : 1 - 2.59 * r + 5.11 * r * r - 3.52 * r ** 3;
    IR += gamma * c.netLoad * HEAT * etaM * etaS;                      // BTU/ft²/min
  }

  // Flusso propagante (eq. 42) e calore necessario all'accensione (eq. 77).
  const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  let heatSink = 0;
  for (const c of cat) for (const p of c.particles) {
    if (p.s > 0) heatSink += c.frac * p.f * Math.exp(-138 / p.s) * (250 + 1116 * p.M);
  }
  heatSink *= rhoB;
  const R0 = heatSink > 0 ? (IR * xi) / heatSink : 0;                   // ft/min

  return {
    sigma, beta, betaRel, IR, xi, heatSink, R0, mxLive, mDead: D.M, mLive: L.M, depth: m.depth,
    windC: 7.47 * Math.exp(-0.133 * sigma ** 0.55),
    windB: 0.02526 * sigma ** 0.54,
    windE: 0.715 * Math.exp(-0.000359 * sigma),
    slopeK: 5.275 * beta ** -0.3,
  };
}

/** Somme per categoria (morto o vivo): area, frazioni f, SAV, umidità e carico netto pesati. */
function summarize(particles) {
  const ps = particles.map((p) => ({ ...p, a: p.s > 0 ? (p.w * p.s) / RHO_P : 0 }));
  const area = ps.reduce((t, p) => t + p.a, 0);
  for (const p of ps) p.f = area > 1e-7 ? p.a / area : 0;
  // Pesi per classe di dimensione (Albini 1976): particelle con SAV simile condividono il peso g.
  const bin = (s) => (s >= 1200 ? 0 : s >= 192 ? 1 : s >= 96 ? 2 : s >= 48 ? 3 : s >= 16 ? 4 : -1);
  const g = [0, 0, 0, 0, 0];
  for (const p of ps) if (bin(p.s) >= 0) g[bin(p.s)] += p.f;
  let sigma = 0, M = 0, netLoad = 0, load = 0;
  for (const p of ps) {
    if (p.s <= 0) continue;
    sigma += p.f * p.s; M += p.f * p.M; load += p.w;
    netLoad += (bin(p.s) >= 0 ? g[bin(p.s)] : 0) * p.w * (1 - S_T);
  }
  return { particles: ps, area, sigma, M, netLoad, load };
}

/**
 * Velocità e direzione di massima propagazione.
 * @param fb       letto da fuelbed()
 * @param midflame vento a metà fiamma, ft/min
 * @param windTo   azimut verso cui soffia il vento (gradi da Nord)
 * @param tanSlope tangente della pendenza
 * @param aspect   esposizione: azimut verso cui il versante scende (gradi; -1 = piano)
 * @param opts.windLimit limite del vento efficace a 0,9·I_R (Rothermel 1972). Spento di default, come in
 *        Behave: Andrews et al. (2013) mostrano che taglia troppo le velocità con vento forte.
 * @returns {ros (ft/min), dir (gradi da Nord), phiW, phiS, effWind (ft/min, vento efficace), limited}
 */
export function spread(fb, midflame, windTo, tanSlope, aspect, opts = {}) {
  if (!fb || fb.R0 <= 0) return { ros: 0, dir: 0, phiW: 0, phiS: 0, effWind: 0 };
  const phiW = midflame > 1e-7 ? fb.windC * midflame ** fb.windB * fb.betaRel ** -fb.windE : 0;
  const phiS = Math.min(fb.slopeK * tanSlope * tanSlope, 0.9 * fb.IR);   // come Behave
  const upslope = aspect < 0 ? 0 : (aspect + 180) % 360;

  // Somma vettoriale nel sistema (Est, Nord): pendenza verso monte, vento verso cui soffia.
  const x = fb.R0 * (phiS * Math.sin(upslope * RAD) + phiW * Math.sin(windTo * RAD));
  const y = fb.R0 * (phiS * Math.cos(upslope * RAD) + phiW * Math.cos(windTo * RAD));
  const add = Math.hypot(x, y);
  let ros = fb.R0 + add;
  const dir = add > 1e-9 ? ((Math.atan2(x, y) / RAD) + 360) % 360 : windTo;

  // Vento efficace: il vento che da solo darebbe la stessa velocità (serve all'ellisse, giorno 6).
  const phiE = ros / fb.R0 - 1;
  let effWind = phiE > 0 ? ((phiE * fb.betaRel ** fb.windE) / fb.windC) ** (1 / fb.windB) : 0;
  let limited = false;
  if (opts.windLimit && effWind > 0.9 * fb.IR) {
    limited = true;
    effWind = 0.9 * fb.IR;
    ros = fb.R0 * (1 + fb.windC * effWind ** fb.windB * fb.betaRel ** -fb.windE);
  }
  return { ros, dir, phiW, phiS, effWind, limited };
}

/**
 * Fattore di riduzione del vento (WAF): dal vento a 20 ft a quello a metà fiamma.
 * Albini & Baughman (1979), come in Behave (crown ratio noto).
 * Scoperto: dipende dallo spessore del combustibile. Sotto chioma: da copertura, altezza e crown ratio.
 * @param depthFt spessore del letto (ft) · cover copertura delle chiome (0–1) · heightFt altezza chiome (ft)
 */
export function windAdjustmentFactor(depthFt, cover = 0, heightFt = 0, crownRatio = 0) {
  const crownFill = (crownRatio * cover) / 3;   // frazione di volume occupata da chiome coniche
  if (cover < 1e-7 || crownFill < 0.05 || heightFt < 6) {
    return 1.83 / Math.log((20 + 0.36 * depthFt) / (0.13 * depthFt));
  }
  return 0.555 / (Math.sqrt(crownFill * heightFt) * Math.log((20 + 0.36 * heightFt) / (0.13 * heightFt)));
}

/** Vento a 10 m (m/s) → vento a metà fiamma (ft/min). 10 m → 20 ft: divisione per 1,15 (come Behave). */
export function midflameFtMin(ws10Ms, waf) {
  return ((ws10Ms / 1.15) * waf * 60) / FT_TO_M;
}

export const ftMinToMMin = (v) => v * FT_TO_M;
