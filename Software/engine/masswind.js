// Vento a conservazione della massa in uno strato sopra il terreno (DECISIONI D53).
//
// Il vento del modello meteo (u₀, uniforme sulla zona) non sa che le montagne esistono: attraversa
// creste e valli senza deviare. Nella realtà, soprattutto di notte con aria stabile, lo strato d'aria
// vicino al suolo è basso e i rilievi lo bloccano: il flusso gira attorno alle cime e si incanala nelle
// valli. È l'idea dei modelli diagnostici a conservazione della massa (MATHEW, Sherman 1978; il
// risolutore di base di WindNinja, Forthofer et al. 2014), qui in forma ridotta a uno strato:
//
//   spessore dello strato   h = max(Z_top − z, h_min),  Z_top = quota media della zona + altezza dello strato limite
//   vento corretto          u = u₀ + ∇λ                 (il più vicino a u₀ nel senso ∫ h |u − u₀|²)
//   vincolo                 ∇·(h u) = 0                 (il flusso d'aria nello strato si conserva)
//   quindi                  ∇·(h ∇λ) = −∇·(h u₀)        con λ = 0 sui bordi (flusso libero di entrare e uscire)
//
// Si risolve con sovrarilassamento (SOR) su una griglia grossolana (default 50 m), poi si interpola sulle
// celle da 10 m. Il risultato è lineare nella velocità: si calcola per vento unitario e per direzione e si
// tiene in cache. Si usano il rapporto di velocità |u|/|u₀| e la direzione di u, applicati al vento a 10 m.
//
// Limiti dichiarati: uno strato solo (vento medio nello strato, non profilo verticale); nessun effetto
// termico (brezze di pendio); altezza dello strato limite da un solo punto meteo.

const RAD = Math.PI / 180;
export const MASS_WIND = { cellM: 50, minFrac: 0.05, maxIter: 20000, tol: 1e-6 };

/** Quote medie a blocchi sulla griglia grossolana. */
function coarsen(grid, f) {
  const R = Math.ceil(grid.rows / f), C = Math.ceil(grid.cols / f), z = new Float64Array(R * C), n = new Uint32Array(R * C);
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const k = Math.floor(r / f) * C + Math.floor(c / f), v = grid.elevation[r * grid.cols + c];
    if (Number.isFinite(v)) { z[k] += v; n[k]++; }
  }
  let mean = 0, m = 0;
  for (let k = 0; k < z.length; k++) if (n[k]) { z[k] /= n[k]; mean += z[k]; m++; }
  mean /= m || 1;
  for (let k = 0; k < z.length; k++) if (!n[k]) z[k] = mean;
  return { R, C, z, mean };
}

/**
 * Campo di vento per vento unitario da `fromDeg` con strato limite alto `blhM` metri.
 * @returns { R, C, f, ratio (Float32Array), dirTo (Float32Array, gradi), iters, residual }
 */
export function solveMassWind(grid, fromDeg, blhM, opts = {}) {
  const { cellM, minFrac, maxIter, tol } = { ...MASS_WIND, ...opts };
  const f = Math.max(1, Math.round(cellM / grid.res)), d = f * grid.res;
  const { R, C, z, mean } = coarsen(grid, f);
  const top = mean + blhM, hmin = minFrac * blhM;
  const h = new Float64Array(R * C);
  for (let k = 0; k < h.length; k++) h[k] = Math.max(top - z[k], hmin);
  // vento unitario verso cui soffia: componenti Est (u) e Nord (v); righe verso Sud
  const to = (fromDeg + 180) * RAD, u0 = Math.sin(to), v0 = Math.cos(to);
  // spessori sulle facce (media armonica: una cella quasi chiusa chiude la faccia)
  const hf = (a, b) => (2 * a * b) / (a + b);
  // termine noto: −∇·(h u₀) con differenze centrate sulle facce
  const rhs = new Float64Array(R * C), lam = new Float64Array(R * C);
  const idx = (r, c) => r * C + c;
  for (let r = 1; r < R - 1; r++) for (let c = 1; c < C - 1; c++) {
    const k = idx(r, c);
    const fe = hf(h[k], h[k + 1]) * u0, fw = hf(h[k], h[k - 1]) * u0;
    const fn = hf(h[k], h[k - C]) * v0, fs = hf(h[k], h[k + C]) * v0;   // Nord = riga precedente
    rhs[k] = -((fe - fw) + (fn - fs)) / d;
  }
  // SOR su ∇·(h ∇λ) = rhs, λ = 0 ai bordi
  const omega = 1.9;
  // arresto: la correzione più grande di un'iterazione sotto tol volte il valore massimo di |λ|
  let it = 0, res = Infinity;
  for (; it < maxIter; it++) {
    let maxd = 0, maxl = 0;
    for (let r = 1; r < R - 1; r++) for (let c = 1; c < C - 1; c++) {
      const k = idx(r, c);
      const ae = hf(h[k], h[k + 1]), aw = hf(h[k], h[k - 1]), an = hf(h[k], h[k - C]), as = hf(h[k], h[k + C]);
      const s = ae + aw + an + as;
      const nv = (ae * lam[k + 1] + aw * lam[k - 1] + an * lam[k - C] + as * lam[k + C] - rhs[k] * d * d) / s;
      const dl = nv - lam[k];
      lam[k] += omega * dl;
      if (Math.abs(dl) > maxd) maxd = Math.abs(dl);
      if (Math.abs(lam[k]) > maxl) maxl = Math.abs(lam[k]);
    }
    res = maxl > 0 ? maxd / maxl : 0;
    if (it > 10 && res < tol) break;
  }
  // u = u₀ + ∇λ (gradiente centrato)
  const ratio = new Float32Array(R * C), dirTo = new Float32Array(R * C);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const k = idx(r, c);
    const gx = c > 0 && c < C - 1 ? (lam[k + 1] - lam[k - 1]) / (2 * d) : 0;
    const gy = r > 0 && r < R - 1 ? (lam[k - C] - lam[k + C]) / (2 * d) : 0;   // verso Nord
    const u = u0 + gx, v = v0 + gy;
    ratio[k] = Math.hypot(u, v);
    dirTo[k] = ((Math.atan2(u, v) / RAD) + 360) % 360;
  }
  return { R, C, f, ratio, dirTo, iters: it, residual: res };
}

/** Valore interpolato (bilineare) dalla griglia grossolana alla cella fine (r, c); per le direzioni sui vettori. */
function sampler(sol, grid) {
  const { R, C, f, ratio, dirTo } = sol;
  return (i) => {
    const r = Math.floor(i / grid.cols), c = i % grid.cols;
    const y = Math.min(R - 1, Math.max(0, (r + 0.5) / f - 0.5)), x = Math.min(C - 1, Math.max(0, (c + 0.5) / f - 0.5));
    const r0 = Math.floor(y), c0 = Math.floor(x), r1 = Math.min(R - 1, r0 + 1), c1 = Math.min(C - 1, c0 + 1);
    const wy = y - r0, wx = x - c0;
    let su = 0, sv = 0;
    for (const [rr, cc, w] of [[r0, c0, (1 - wy) * (1 - wx)], [r0, c1, (1 - wy) * wx], [r1, c0, wy * (1 - wx)], [r1, c1, wy * wx]]) {
      const k = rr * C + cc, a = dirTo[k] * RAD;
      su += w * ratio[k] * Math.sin(a); sv += w * ratio[k] * Math.cos(a);
    }
    return { factor: Math.hypot(su, sv), from: ((Math.atan2(su, sv) / RAD) + 180 + 360) % 360 };
  };
}

/**
 * Correzione per una direzione del vento e un'altezza dello strato limite, con la stessa interfaccia di
 * terrainWindFor: { factor(i), from(i) }. Soluzioni in cache sulla griglia per direzione (passo 5°) e
 * altezza dello strato (passo 50 m).
 */
export function massWindFor(grid, fromDeg, blhM, opts = {}) {
  const dk = (Math.round(fromDeg / 5) * 5) % 360, bk = Math.max(50, Math.round(blhM / 50) * 50);
  const cache = grid._massWind ?? (Object.defineProperty(grid, '_massWind', { value: new Map(), enumerable: false }), grid._massWind);
  const key = `${dk}|${bk}|${opts.cellM ?? MASS_WIND.cellM}`;
  if (!cache.has(key)) {
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(key, sampler(solveMassWind(grid, dk, bk, opts), grid));
  }
  const s = cache.get(key), rot = fromDeg - dk;   // piccola rotazione residua dentro il passo di 5°
  const memo = new Map();
  const at = (i) => { let v = memo.get(i); if (!v) { v = s(i); memo.set(i, v); } return v; };
  return { factor: (i) => at(i).factor, from: (i) => (at(i).from + rot + 360) % 360 };
}
