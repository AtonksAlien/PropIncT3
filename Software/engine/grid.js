// Pacchetto zona in memoria: un TypedArray per layer, indice di cella i = r * cols + c.
// Riga 0 = bordo Nord, colonna 0 = bordo Ovest (come in manifest.json, row_order "nord-sud").

import { parseNpy } from './npy.js';
import { latLonToUtm, utmToLatLon, utmZoneOf } from './geo.js';

export const LAYERS = ['fuel', 'slope', 'aspect', 'tan_slope', 'elevation', 'ndvi'];
export const OPTIONAL_LAYERS = ['barriers', 'barrier_width'];   // da pipeline/barriers.js (OpenStreetMap)

// Codici del layer barriers che fermano il fuoco (pipeline/barriers.js): strada asfaltata, ferrovia, acqua.
export const BLOCKING_BARRIERS = [1, 3, 4];
export const IMPASSABLE_WIDTH = 255;   // valore del layer barrier_width per le barriere invalicabili

/**
 * Griglia con le barriere: le celle di strada asfaltata, ferrovia e acqua diventano non combustibili
 * (combustibile 0). In più `gapWidth` (Float32Array, metri) dice quanto è larga la fascia senza combustibile
 * in ogni cella di barriera: il tempo di arrivo la fa saltare al fronte se la sua lunghezza di fiamma basta
 * (engine/mtt.js). Infinity = invalicabile: tutte le celle non combustibili che non sono barriere, le barriere
 * segnate 255 e, con `absolute` o senza il layer delle larghezze, tutte le barriere (comportamento precedente).
 * Gli altri layer sono condivisi; ogni variante si costruisce una volta e resta in cache.
 */
export function withBarriers(grid, { absolute = false } = {}) {
  if (!grid.barriers) return grid;
  const key = absolute || !grid.barrierWidth ? '_barriersAbs' : '_barriersGap';
  if (!grid[key]) {
    const fuel = Uint8Array.from(grid.fuel);
    const gapWidth = new Float32Array(grid.n).fill(Infinity);
    for (let i = 0; i < grid.n; i++) {
      if (!BLOCKING_BARRIERS.includes(grid.barriers[i])) continue;
      fuel[i] = 0;
      const w = key === '_barriersGap' ? grid.barrierWidth[i] : IMPASSABLE_WIDTH;
      if (w > 0 && w < IMPASSABLE_WIDTH) gapWidth[i] = w;
    }
    grid[key] = { ...grid, fuel, gapWidth, _barriersAbs: undefined, _barriersGap: undefined };
  }
  return grid[key];
}

/** Costruisce la griglia da manifest + buffer già letti (indipendente da Node/browser). */
export function buildGrid(manifest, buffers) {
  const { rows, cols, resolution_m: res } = manifest;
  const grid = { rows, cols, res, n: rows * cols, manifest };
  for (const [name, buf] of Object.entries(buffers)) {
    const { data, shape } = parseNpy(buf);
    if (shape[0] !== rows || shape[1] !== cols) {
      throw new Error(`${name}: forma ${shape} diversa da ${rows}x${cols}`);
    }
    grid[camel(name)] = data;
  }
  return grid;
}

/** Griglia sintetica per i test: combustibile e pendenza uniformi. */
export function uniformGrid(rows, cols, { res = 10, fuel = 1, slopeDeg = 0, aspectDeg = -1, ndvi = 0.3 } = {}) {
  const n = rows * cols;
  const g = { rows, cols, res, n, manifest: null };
  g.fuel = new Uint8Array(n).fill(fuel);
  g.slope = new Float32Array(n).fill(slopeDeg);
  g.aspect = new Float32Array(n).fill(aspectDeg);
  g.tanSlope = new Float32Array(n).fill(Math.tan((slopeDeg * Math.PI) / 180));
  g.ndvi = new Float32Array(n).fill(ndvi);
  // Quota coerente con pendenza ed esposizione (aspect = direzione verso cui il versante scende).
  g.elevation = new Float32Array(n);
  if (aspectDeg >= 0) {
    const a = (aspectDeg * Math.PI) / 180, t = g.tanSlope[0];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const east = c * res, north = -r * res;
      g.elevation[r * cols + c] = 500 - t * (east * Math.sin(a) + north * Math.cos(a));
    }
  } else g.elevation.fill(500);
  return g;
}

/** Da coordinate UTM a (riga, colonna). */
export function utmToCell(grid, x, y) {
  const o = grid.manifest.origin_utm;
  return { r: Math.floor((o.y - y) / grid.res), c: Math.floor((x - o.x) / grid.res) };
}

/** Da lat/lon (WGS84) a (riga, colonna), con la proiezione UTM esatta (geo.js). */
export function latLonToCell(grid, lat, lon) {
  const { x, y } = latLonToUtm(lat, lon, utmZoneOf(grid.manifest.crs));
  return utmToCell(grid, x, y);
}

/** Centro della cella (r, c) in lat/lon. */
export function cellToLatLon(grid, r, c) {
  const o = grid.manifest.origin_utm;
  return utmToLatLon(o.x + (c + 0.5) * grid.res, o.y - (r + 0.5) * grid.res, utmZoneOf(grid.manifest.crs));
}

/** Celle dentro la griglia e combustibili: gli inneschi validi. */
export function isIgnitable(grid, { r, c }) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < grid.rows && c < grid.cols
    && grid.fuel[r * grid.cols + c] > 0;
}

const camel = (s) => s.replace(/_(\w)/g, (_, ch) => ch.toUpperCase());
