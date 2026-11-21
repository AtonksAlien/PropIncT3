// Campo di vento esterno (es. WindNinja) come correzione per cella (PROBLEMI P37).
//
// WindNinja (Forthofer et al. 2014) con inizializzazione "domain average" produce, per un vento uniforme
// in ingresso (velocità V e direzione θ), due griglie ASCII: velocità a 10 m (m/s) e direzione da cui
// proviene il vento (gradi). Qui si trasformano in una correzione con la stessa interfaccia di
// masswind.js e terrainwind.js: { factor(i) = velocità / V, from(i) = direzione locale }.
// Con più corse a direzioni diverse si usa quella più vicina al vento del momento, ruotata della differenza.

const RAD = Math.PI / 180;

/** Griglia ASCII di ESRI/GDAL (AAIGrid): intestazione e valori, riga 0 = Nord. */
export function parseAsc(text) {
  const lines = text.split(/\r?\n/);
  const h = {};
  let k = 0;
  for (; k < lines.length; k++) {
    const m = lines[k].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
    if (!m) break;
    h[m[1].toLowerCase()] = Number(m[2]);
  }
  const ncols = h.ncols, nrows = h.nrows, cell = h.cellsize;
  const xll = h.xllcorner ?? (h.xllcenter - cell / 2), yll = h.yllcorner ?? (h.yllcenter - cell / 2);
  const data = new Float32Array(ncols * nrows);
  let n = 0;
  for (; k < lines.length && n < data.length; k++) {
    for (const t of lines[k].trim().split(/\s+/)) if (t !== '') data[n++] = Number(t);
  }
  if (n !== data.length) throw new Error(`Griglia ASCII incompleta: ${n} valori su ${data.length}`);
  const nodata = h.nodata_value;
  if (nodata !== undefined) for (let i = 0; i < data.length; i++) if (data[i] === nodata) data[i] = NaN;
  return { ncols, nrows, cell, xll, yll, ymax: yll + nrows * cell, data };
}

/**
 * Prepara una corsa per la griglia del motore: per ogni cella da 10 m interpola (bilineare, sui vettori)
 * velocità e direzione. Tutte le griglie devono stare nello stesso sistema di riferimento della zona.
 * @param run { fromDeg, speed (m/s), vel (parseAsc), ang (parseAsc), velUnit ('mps' | 'mph' | 'kph') }
 *            WindNinja scrive le velocità in miglia orarie se la configurazione non chiede altro
 */
export function prepareRun(grid, run) {
  const { vel, ang } = run, o = grid.manifest.origin_utm;
  const toMs = { mps: 1, mph: 0.44704, kph: 1 / 3.6 }[run.velUnit ?? 'mps'];
  if (!toMs) throw new Error(`Unità di velocità sconosciuta: ${run.velUnit}`);
  const u = new Float32Array(vel.data.length), v = new Float32Array(vel.data.length);
  for (let k = 0; k < u.length; k++) {
    const s = (vel.data[k] * toMs) / run.speed, to = (ang.data[k] + 180) * RAD;
    u[k] = s * Math.sin(to); v[k] = s * Math.cos(to);
  }
  const factor = new Float32Array(grid.n), from = new Float32Array(grid.n);
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const x = o.x + (c + 0.5) * grid.res, y = o.y - (r + 0.5) * grid.res;
    const fx = Math.min(vel.ncols - 1, Math.max(0, (x - vel.xll) / vel.cell - 0.5));
    const fy = Math.min(vel.nrows - 1, Math.max(0, (vel.ymax - y) / vel.cell - 0.5));
    const c0 = Math.floor(fx), r0 = Math.floor(fy), c1 = Math.min(vel.ncols - 1, c0 + 1), r1 = Math.min(vel.nrows - 1, r0 + 1);
    const wx = fx - c0, wy = fy - r0;
    let su = 0, sv = 0, sw = 0;
    for (const [rr, cc, w] of [[r0, c0, (1 - wy) * (1 - wx)], [r0, c1, (1 - wy) * wx], [r1, c0, wy * (1 - wx)], [r1, c1, wy * wx]]) {
      const k = rr * vel.ncols + cc;
      if (!Number.isFinite(u[k]) || !Number.isFinite(v[k])) continue;
      su += w * u[k]; sv += w * v[k]; sw += w;
    }
    const i = r * grid.cols + c;
    if (sw > 0) { su /= sw; sv /= sw; factor[i] = Math.hypot(su, sv); from[i] = ((Math.atan2(su, sv) / RAD) + 180 + 360) % 360; }
    else { factor[i] = 1; from[i] = run.fromDeg; }
  }
  return { fromDeg: run.fromDeg, factor, from };
}

/** Unità delle velocità scritte da WindNinja secondo la sua configurazione (default: miglia orarie). */
export function windNinjaSpeedUnit(cfgText) {
  const m = cfgText.match(/^\s*output_speed_units\s*=\s*(\w+)/m);
  return m ? m[1].toLowerCase() : 'mph';
}

/** Correzione per il vento da `fromDeg`: corsa più vicina, ruotata della differenza. */
export function windFieldFor(runs, fromDeg) {
  let best = runs[0], bd = Infinity;
  for (const r of runs) {
    const d = Math.abs(((fromDeg - r.fromDeg + 540) % 360) - 180);
    if (d < bd) { bd = d; best = r; }
  }
  const rot = ((fromDeg - best.fromDeg + 540) % 360) - 180;
  return { factor: (i) => best.factor[i], from: (i) => (best.from[i] + rot + 360) % 360, runFrom: best.fromDeg };
}
