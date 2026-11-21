// Confronto nel tempo tra simulazione e incendio reale, passaggio per passaggio del satellite.
// Funzione pura (niente file né rete): la usano validate.js, validation/temporal.js e i test.
//
// Durante l'incendio l'unico dato con l'ora sono i punti caldi FIRMS (VIIRS 375 m, MODIS 1 km).
// Un punto caldo dice che all'ora del passaggio in quel pixel c'era fuoco attivo: il fronte è arrivato
// in quel momento o prima. Da qui due famiglie di misure per ogni passaggio, all'ora t:
//
//  1. punto per punto: primo arrivo simulato nel pixel del punto caldo (come hotspotTiming).
//     "Ritardo" = max(0, arrivo simulato - t): è un errore certo, perché il fuoco c'era già.
//     Un arrivo simulato prima di t non è un errore dimostrabile (il pixel poteva bruciare da prima).
//  2. per area: area osservata fino a t = unione dei pixel dei punti caldi di tutti i passaggi fino a t,
//     ristretta al perimetro finale (Copernicus EMS); area simulata = celle con arrivo <= t.
//     Indice di Sørensen tra le due, e lo sfasamento: lo spostamento di tempo τ per cui la simulazione
//     a t+τ somiglia di più all'osservato a t (τ > 0: la simulazione è in ritardo).
//     Riferimento: il perimetro finale intero a ogni ora (chi non sa nulla dell'evoluzione nel tempo).

const quantile = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : null);

/** Celle del pixel di un punto caldo: quadrato di lato sizeKm centrato sul punto (come hotspotTiming). */
export function footprintCells(grid, h, cell) {
  const { rows, cols, res } = grid;
  const half = Math.max(1, Math.round((h.sizeKm * 1000) / 2 / res));
  const out = [];
  for (let r = Math.max(0, cell.r - half); r <= Math.min(rows - 1, cell.r + half); r++) {
    for (let c = Math.max(0, cell.c - half); c <= Math.min(cols - 1, cell.c + half); c++) out.push(r * cols + c);
  }
  return out;
}

/**
 * Raggruppa i punti caldi dentro la zona per passaggio (stessa ora), in ordine di tempo.
 * @param cellOf (grid, lat, lon) → { r, c } | null
 * @returns [{ time: ISO, tMin, instruments, points: [{ h, cell, cells }] }]
 */
export function groupPasses(grid, hotspots, startMs, cellOf) {
  const by = new Map();
  for (const h of hotspots) {
    const cell = cellOf(grid, h.lat, h.lon);
    if (!cell) continue;
    const k = h.time.getTime();
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ h, cell, cells: footprintCells(grid, h, cell) });
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([ms, points]) => ({
    time: new Date(ms).toISOString(), tMin: (ms - startMs) / 60000,
    instruments: [...new Set(points.map((p) => p.h.instrument))].join('+'), points,
  }));
}

/** Indici delle celle del dominio con arrivo finito, ordinati per tempo di arrivo. */
function sortedByArrival(arrival, domain) {
  const idx = [];
  for (let i = 0; i < arrival.length; i++) if (domain[i] && Number.isFinite(arrival[i])) idx.push(i);
  const a = Float64Array.from(idx, (i) => arrival[i]);
  const order = Array.from(idx.keys()).sort((x, y) => a[x] - a[y]);
  return { cells: Int32Array.from(order, (k) => idx[k]), times: Float64Array.from(order, (k) => a[k]) };
}

/**
 * Sørensen tra la maschera osservata obs (|obs| = nObs) e "arrivo <= T" al variare di T, in una sola scansione.
 * @returns { at(T) → { sorensen, tp, sim }, best: { T, sorensen } }  best cercato tra tLo e tHi
 */
function sorensenCurve(sorted, obs, nObs, tLo, tHi) {
  const { cells, times } = sorted;
  const tpAt = new Int32Array(cells.length + 1);       // tpAt[k] = celle osservate tra le prime k
  for (let k = 0; k < cells.length; k++) tpAt[k + 1] = tpAt[k] + (obs[cells[k]] ? 1 : 0);
  const countLe = (T) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= T) lo = m + 1; else hi = m; } return lo; };
  const score = (k) => (nObs + k > 0 ? (2 * tpAt[k]) / (nObs + k) : null);
  let best = { T: tLo, sorensen: score(countLe(tLo)) ?? 0 };
  for (let k = countLe(tLo); k <= countLe(tHi); k++) {
    const s = score(k);
    if (s !== null && s > best.sorensen) best = { T: k > 0 ? times[k - 1] : tLo, sorensen: s };
  }
  return { at: (T) => { const k = countLe(T); return { sorensen: score(k), tp: tpAt[k], sim: k }; }, best };
}

/**
 * @param o.grid
 * @param o.arrival   tempo di arrivo simulato (minuti dall'innesco della simulazione; Infinity = mai)
 * @param o.passes    groupPasses(...) calcolato con l'ora di innesco del caso
 * @param o.obsMask   perimetro finale rasterizzato; o.domain celle combustibili (1/0)
 * @param o.offsetMin spostamento dell'innesco di questa simulazione rispetto all'ora del caso (insieme)
 * @param o.maxMin    durata simulata; o.tolMin tolleranza per "raggiunto in tempo" (default 60)
 */
export function temporalAnalysis(o) {
  const { grid, arrival, passes, obsMask, domain, offsetMin = 0, maxMin, tolMin = 60 } = o;
  const cellHa = grid.res ** 2 / 1e4;
  const sorted = sortedByArrival(arrival, domain);
  const seen = new Uint8Array(grid.n);                    // area osservata cumulata
  let nObs = 0, nFinal = 0;
  for (let i = 0; i < grid.n; i++) if (obsMask[i] && domain[i]) nFinal++;
  const out = [];
  for (const p of passes) {
    const t = p.tMin - offsetMin;                         // ora del passaggio sull'orologio della simulazione
    if (t < 0 || t > maxMin) continue;
    // 1. punto per punto
    const pts = p.points.map(({ h, cells }) => {
      let first = Infinity;
      for (const i of cells) first = Math.min(first, arrival[i]);
      return { lat: h.lat, lon: h.lon, instrument: h.instrument, simFirstMin: Number.isFinite(first) ? first : null,
        errMin: Number.isFinite(first) ? first - t : null, lateMin: Number.isFinite(first) ? Math.max(0, first - t) : null };
    });
    const reached = pts.filter((q) => q.simFirstMin !== null);
    const late = reached.map((q) => q.lateMin).sort((a, b) => a - b);
    const signed = reached.map((q) => q.errMin).sort((a, b) => a - b);
    // 2. per area
    for (const { cells } of p.points) for (const i of cells) if (obsMask[i] && domain[i] && !seen[i]) { seen[i] = 1; nObs++; }
    const curve = sorensenCurve(sorted, seen, nObs, 0, maxMin);
    const now = curve.at(t);
    out.push({
      time: p.time, tMin: p.tMin, tSimMin: t, instruments: p.instruments, n: pts.length,
      points: pts,
      hotspots: {
        reachedByT: pts.filter((q) => q.simFirstMin !== null && q.simFirstMin <= t).length / pts.length,
        reachedByTtol: pts.filter((q) => q.simFirstMin !== null && q.simFirstMin <= t + tolMin).length / pts.length,
        notReached: pts.length - reached.length,
        lateMedianMin: quantile(late, 0.5), lateMeanMin: late.length ? late.reduce((s, x) => s + x, 0) / late.length : null,
        lateRmseMin: late.length ? Math.sqrt(late.reduce((s, x) => s + x * x, 0) / late.length) : null,
        signedMedianMin: quantile(signed, 0.5),
      },
      area: {
        observedHa: nObs * cellHa, simulatedHa: now.sim * cellHa,
        sorensen: now.sorensen, precision: now.sim ? now.tp / now.sim : null, recall: nObs ? now.tp / nObs : null,
        bestLagMin: curve.best.T - t, sorensenBestLag: curve.best.sorensen,
        referenceFinalPerimeter: nObs + nFinal ? (2 * nObs) / (nObs + nFinal) : null,
      },
    });
  }
  return out;
}

/** Riassunto di più analisi (insieme): mediana e quartili delle misure di ogni passaggio. */
export function summarizeMembers(list) {
  const times = [...new Set(list.flatMap((a) => a.map((p) => p.time)))].sort();
  const stat = (v) => { v = v.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return { median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75) }; };
  return times.map((time) => {
    const ps = list.map((a) => a.find((p) => p.time === time)).filter(Boolean);
    return {
      time, tMin: ps[0].tMin, instruments: ps[0].instruments, n: ps[0].n, members: ps.length,
      observedHa: ps[0].area.observedHa, referenceFinalPerimeter: ps[0].area.referenceFinalPerimeter,
      sorensen: stat(ps.map((x) => x.area.sorensen)),
      bestLagMin: stat(ps.map((x) => x.area.bestLagMin)),
      simulatedHa: stat(ps.map((x) => x.area.simulatedHa)),
      reachedByTtol: stat(ps.map((x) => x.hotspots.reachedByTtol)),
      lateRmseMin: stat(ps.map((x) => x.hotspots.lateRmseMin)),
    };
  });
}

/**
 * Confronto tra due mappe dei tempi di arrivo (verifica codice contro codice, es. FlamMap e PropInc con gli
 * stessi ingressi): a ogni istante di `times` Sørensen e rapporto delle aree tra "arrivo <= t" nelle due mappe;
 * sulle celle raggiunte da entrambe entro l'ultimo istante, differenza dei tempi (b − a).
 */
export function compareArrivals(a, b, domain, times, cellHa = 0.01) {
  const steps = times.map((t) => {
    let tp = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      if (!domain[i]) continue;
      const x = a[i] <= t, y = b[i] <= t;
      if (x) na++; if (y) nb++; if (x && y) tp++;
    }
    return { tMin: t, aHa: na * cellHa, bHa: nb * cellHa, sorensen: na + nb ? (2 * tp) / (na + nb) : null, areaRatio: na ? nb / na : null };
  });
  const tMax = Math.max(...times), d = [];
  for (let i = 0; i < a.length; i++) if (domain[i] && a[i] <= tMax && b[i] <= tMax) d.push(b[i] - a[i]);
  d.sort((x, y) => x - y);
  const abs = d.map(Math.abs).sort((x, y) => x - y);
  return {
    steps,
    arrivalDiff: { cells: d.length, medianMin: quantile(d, 0.5), q1Min: quantile(d, 0.25), q3Min: quantile(d, 0.75), medianAbsMin: quantile(abs, 0.5),
      rmseMin: d.length ? Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length) : null },
  };
}
