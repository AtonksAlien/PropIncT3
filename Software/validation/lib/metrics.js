// Metriche di somiglianza tra area bruciata osservata e simulata, cella per cella.
//
// Tutte le misure si calcolano su un "dominio" di celle (di norma quelle combustibili): una strada o una
// roccia dentro il perimetro osservato non è un errore del modello, che non può bruciarla.
//
//   VP = bruciata in entrambe · FP = solo simulata (falso allarme) · FN = solo osservata (mancata)
//   Sørensen (Dice) = 2VP / (2VP + FP + FN)        Jaccard = VP / (VP + FP + FN)
//   precisione = VP / (VP + FP)                    recall (sensibilità) = VP / (VP + FN)
//   rapporto d'area = simulata / osservata         kappa di Cohen: accordo oltre quello dovuto al caso

/** Maschera delle celle con tempo di arrivo ≤ t (minuti). */
export function maskAt(arrival, t) {
  const m = new Uint8Array(arrival.length);
  for (let i = 0; i < arrival.length; i++) if (arrival[i] <= t && arrival[i] !== Infinity) m[i] = 1;
  return m;
}

/**
 * Maschera "ad area uguale": le K celle del dominio raggiunte per prime, con K = celle osservate.
 * Toglie l'incertezza sull'ora di fine (spegnimento, perimetro rilevato giorni dopo) e confronta solo la forma.
 * @returns { mask, tMin: istante in cui il modello raggiunge l'area osservata (null se non la raggiunge) }
 */
export function areaMatchedMask(arrival, domain, K) {
  const times = [];
  for (let i = 0; i < arrival.length; i++) if (domain[i] && Number.isFinite(arrival[i])) times.push(arrival[i]);
  if (K <= 0) return { mask: new Uint8Array(arrival.length), tMin: 0 };
  times.sort((a, b) => a - b);
  const tMin = times.length >= K ? times[K - 1] : null;
  return { mask: maskAt(arrival, tMin ?? Infinity), tMin };
}

/** Matrice di confusione e indici, ristretti al dominio. */
export function confusion(obs, sim, domain) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < obs.length; i++) {
    if (!domain[i]) continue;
    const o = obs[i] === 1, s = sim[i] === 1;
    if (o && s) tp++; else if (s) fp++; else if (o) fn++; else tn++;
  }
  const n = tp + fp + fn + tn, simN = tp + fp, obsN = tp + fn;
  const po = n ? (tp + tn) / n : 1;
  const pe = n ? (simN * obsN + (n - simN) * (n - obsN)) / (n * n) : 1;
  const div = (a, b) => (b ? a / b : null);
  return {
    tp, fp, fn, tn,
    sorensen: div(2 * tp, 2 * tp + fp + fn) ?? 1,
    jaccard: div(tp, tp + fp + fn) ?? 1,
    precision: div(tp, simN),
    recall: div(tp, obsN),
    areaRatio: div(simN, obsN),
    kappa: pe < 1 ? (po - pe) / (1 - pe) : 1,
  };
}

/**
 * Miglioramento rispetto a un riferimento ("skill score"): 0 = come il riferimento, 1 = perfetto,
 * negativo = peggio del riferimento. Es. Sørensen 0,70 contro 0,50 dell'ellisse → (0,70−0,50)/(1−0,50) = 0,40.
 */
export function skill(score, reference) {
  if (score == null || reference == null) return null;
  return reference < 1 ? (score - reference) / (1 - reference) : null;
}

export const cellsToHa = (k, res) => (k * res * res) / 1e4;
