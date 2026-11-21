// Vento corretto dal rilievo, cella per cella (DECISIONI D52).
//
// Il modello meteo (ECMWF IFS, circa 9 km) dà un vento uguale su tutta la zona. In terreno montuoso il
// vento accelera sui versanti esposti e sulle creste, rallenta nelle valli e sottovento e devia lungo i
// versanti. Qui si usa la correzione empirica di MicroMet (Liston & Elder 2006), con la deviazione
// della direzione di Ryan (1977):
//
//   pendenza nella direzione del vento  Ωs = β · cos(θ − ξ)            (β pendenza in radianti, ξ esposizione,
//                                                                       θ direzione di provenienza del vento)
//   curvatura alla scala η              Ωc = ¼ Σ (z − media delle due quote opposte a distanza η) / (2·distanza)
//                                            su N–S, E–O e le due diagonali
//   entrambe riscalate in [−0,5; +0,5] dividendo per il doppio del massimo valore assoluto nella zona
//   velocità                            W = W₀ · (1 + γs·Ωs + γc·Ωc),   γs = γc = 0,5  →  fattore 0,5 … 1,5
//   direzione                           θ' = θ + θd,   θd = −0,5 · Ωs · sin 2(ξ − θ)   (radianti)
//
// Non è un modello a conservazione della massa come WindNinja (Forthofer et al. 2014), che qui non si
// può installare: è la correzione più semplice con costanti pubblicate. Limiti dichiarati: la scala di
// riscalatura dipende dalla zona; nessun effetto termico (brezze), nessuna separazione del flusso.

const RAD = Math.PI / 180;
export const TERRAIN_WIND = { etaM: 500, slopeWeight: 0.5, curvWeight: 0.5 };

/** Curvatura riscalata in [−0,5; 0,5] (indipendente dalla direzione del vento); in cache sulla griglia. */
export function curvature(grid, etaM = TERRAIN_WIND.etaM) {
  const key = `_curv${etaM}`;
  if (grid[key]) return grid[key];
  const { rows, cols, res, elevation: z } = grid;
  const k = Math.max(1, Math.round(etaM / res)), d = k * res, dd = d * Math.SQRT2;
  const at = (r, c) => z[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  const out = new Float32Array(grid.n);
  let max = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const z0 = z[r * cols + c];
    const v = 0.25 * ((z0 - 0.5 * (at(r, c - k) + at(r, c + k))) / (2 * d)
      + (z0 - 0.5 * (at(r - k, c) + at(r + k, c))) / (2 * d)
      + (z0 - 0.5 * (at(r + k, c - k) + at(r - k, c + k))) / (2 * dd)
      + (z0 - 0.5 * (at(r - k, c - k) + at(r + k, c + k))) / (2 * dd));
    out[r * cols + c] = v;
    if (Math.abs(v) > max) max = Math.abs(v);
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= 2 * max;
  Object.defineProperty(grid, key, { value: out, enumerable: false });
  return out;
}

/** Pendenza in radianti per cella, in cache. */
function slopeRad(grid) {
  if (grid._slopeRad) return grid._slopeRad;
  const s = new Float32Array(grid.n);
  for (let i = 0; i < grid.n; i++) s[i] = Math.atan(grid.tanSlope[i]);
  Object.defineProperty(grid, '_slopeRad', { value: s, enumerable: false });
  return s;
}

/**
 * Correzione per una direzione del vento θ (gradi, provenienza): ritorna { factor(i), from(i) } calcolati
 * su richiesta per la cella i. Il massimo di |β·cos(θ − ξ)| per la riscalatura si calcola una volta (O(n)).
 */
export function terrainWindFor(grid, fromDeg, opts = {}) {
  const { etaM, slopeWeight, curvWeight } = { ...TERRAIN_WIND, ...opts };
  const curv = curvature(grid, etaM), beta = slopeRad(grid), asp = grid.aspect, th = fromDeg * RAD;
  let max = 0;
  for (let i = 0; i < grid.n; i++) {
    if (asp[i] < 0) continue;
    const v = Math.abs(beta[i] * Math.cos(th - asp[i] * RAD));
    if (v > max) max = v;
  }
  const scale = max > 0 ? 1 / (2 * max) : 0;
  const omegaS = (i) => (asp[i] < 0 ? 0 : beta[i] * Math.cos(th - asp[i] * RAD) * scale);
  return {
    factor: (i) => Math.max(0, 1 + slopeWeight * omegaS(i) + curvWeight * curv[i]),
    from: (i) => {
      if (asp[i] < 0) return fromDeg;
      const thd = -0.5 * omegaS(i) * Math.sin(2 * (asp[i] * RAD - th));
      return (((fromDeg + thd / RAD) % 360) + 360) % 360;
    },
  };
}
