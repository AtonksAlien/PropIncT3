#!/usr/bin/env node
// Confronto nel tempo e a fine incendio per una mappa dei tempi di arrivo qualsiasi: quella salvata da
// validate.js (arrivo.npy) oppure quella di un altro simulatore (FlamMap, FARSITE: griglia ASCII .asc).
//
//   node validation/temporal.js --case siniscola-2019                               (arrivo.npy di validate.js)
//   node validation/temporal.js --case siniscola-2019 --arrivo percorso/arrivaltime.asc --unita min --nome flammap
//
// Opzioni: --arrivo <file .npy|.asc>  (default data/zones/<zona>/validation/<caso>/arrivo.npy)
//          --unita min|h  unità della griglia ASCII (default min) · --nome <etichetta> (sottocartella dei risultati)
//          --sposta <min>  minuti tra l'innesco del caso e lo zero della mappa (default 0) · --tol 60
//          --riferimento <file .npy|.asc>  seconda mappa da confrontare cella per cella con la prima (codice contro
//            codice, es. l'arrivo di PropInc con gli stessi ingressi di FlamMap); scrive confronto_codici.json
// La griglia ASCII deve stare nel sistema di riferimento della zona (UTM); se ha celle diverse da quelle
// della zona viene ricampionata al più vicino. Valori negativi o NODATA = mai raggiunta.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { parseNpy } from '../engine/npy.js';
import { parseAsc } from '../engine/windfield.js';
import { rasterizePerimeter } from './lib/perimeter.js';
import { parseFirms, cellOf } from './lib/hotspots.js';
import { areaMatchedMask, confusion } from './lib/metrics.js';
import { groupPasses, temporalAnalysis, compareArrivals } from './lib/temporal.js';
import { writeTemporal } from './lib/temporal-report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { case: null, arrivo: null, unita: 'min', nome: null, sposta: 0, tol: 60, riferimento: null };
const argv = process.argv.slice(2);
if (argv.length && !argv[0].startsWith('--')) args.case = argv.shift();
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
if (!args.case) fail('Uso: node validation/temporal.js --case <nome> [--arrivo file.asc --unita min|h --nome flammap]');

const kase = JSON.parse(readFileSync(join(ROOT, 'config', 'validation', `${args.case}.json`), 'utf8'));
const zdir = join(ROOT, 'data', 'zones', kase.zone);
const grid = loadZone(join(zdir, 'processed'));
const start = new Date(kase.start), maxMin = Number(kase.hours ?? 24) * 60;
if (!kase.hotspots) fail('Il caso non ha punti caldi: il confronto nel tempo non è possibile');
const hotspots = parseFirms(readFileSync(join(zdir, kase.hotspots), 'utf8'));
const perim = rasterizePerimeter(grid, JSON.parse(readFileSync(join(zdir, kase.perimeter), 'utf8')), { filter: kase.perimeter_filter ?? null });

const valDir = join(zdir, 'validation', args.case);
const src = args.arrivo ? resolve(args.arrivo) : join(valDir, 'arrivo.npy');
if (!existsSync(src)) fail(`Mappa dei tempi di arrivo non trovata: ${src}` + (args.arrivo ? '' : ' (esegui prima validation/validate.js)'));
const arrival = src.endsWith('.npy') ? fromNpy(src) : fromAsc(src, args.unita === 'h' ? 60 : 1);
const shift = Number(args.sposta);
if (shift) for (let i = 0; i < arrival.length; i++) arrival[i] += shift;

const domain = new Uint8Array(grid.n);
let K = 0;
for (let i = 0; i < grid.n; i++) { domain[i] = grid.fuel[i] > 0 ? 1 : 0; if (perim.mask[i] && domain[i]) K++; }
const am = areaMatchedMask(arrival, domain, K);
const final = { ...confusion(perim.mask, am.mask, domain), tMin: am.tMin };
const passes = groupPasses(grid, hotspots, start.getTime(), cellOf);
const temporal = temporalAnalysis({ grid, arrival, passes, obsMask: perim.mask, domain, maxMin, tolMin: Number(args.tol) });

const out = args.nome ? join(valDir, args.nome) : valDir;
mkdirSync(out, { recursive: true });
writeTemporal(out, { source: args.nome ?? 'PropInc', file: src, case: args.case, start: start.toISOString(), finalAreaMatched: final, passes: temporal, ensemble: null, members: 0 });
writeFileSync(join(out, 'fine_incendio.json'), JSON.stringify({ source: args.nome ?? 'PropInc', file: src, areaMatched: final }, null, 2));
console.log(`Fine incendio, ad area uguale: Sørensen ${(100 * final.sorensen).toFixed(1)}% (raggiunta a ${final.tMin === null ? 'mai' : Math.round(final.tMin) + ' min'})`);
for (const p of temporal) {
  console.log(`${p.time.slice(0, 16)}  +${Math.round(p.tMin)} min  ${p.instruments.padEnd(10)} Sørensen ${(100 * p.area.sorensen).toFixed(1)}%  `
    + `(perimetro finale ${(100 * p.area.referenceFinalPerimeter).toFixed(1)}%)  sfasamento ${Math.round(p.area.bestLagMin)} min  `
    + `punti raggiunti ${(100 * p.hotspots.reachedByTtol).toFixed(0)}%`);
}
if (args.riferimento) {
  const refPath = resolve(args.riferimento);
  const ref = refPath.endsWith('.npy') ? fromNpy(refPath) : fromAsc(refPath, args.unita === 'h' ? 60 : 1);
  const times = [60, 120, 180, 240, 360, 480, 720, 1080, 1440].filter((t) => t <= maxMin);
  const cmp = compareArrivals(ref, arrival, domain, times, grid.res ** 2 / 1e4);
  writeFileSync(join(out, 'confronto_codici.json'), JSON.stringify({ a: refPath, b: src, ...cmp }, null, 2));
  console.log(`\nCodice contro codice (b = ${args.nome ?? 'mappa'}, a = riferimento):`);
  for (const s of cmp.steps) console.log(`  ${String(s.tMin).padStart(5)} min  a ${s.aHa.toFixed(0)} ha  b ${s.bHa.toFixed(0)} ha  Sørensen ${s.sorensen === null ? '–' : (100 * s.sorensen).toFixed(1) + '%'}`);
  const d = cmp.arrivalDiff;
  console.log(`  differenza dei tempi b − a su ${d.cells} celle comuni: mediana ${d.medianMin?.toFixed(1)} min (quartili ${d.q1Min?.toFixed(1)}, ${d.q3Min?.toFixed(1)}), |mediana| ${d.medianAbsMin?.toFixed(1)}, RMSE ${d.rmseMin?.toFixed(1)}`);
}
console.log(`\nRisultati in ${out}`);

function fail(msg) { console.error(msg); process.exit(1); }

function fromNpy(path) {
  const b = readFileSync(path);
  const a = parseNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const data = a.data ?? a;
  if (data.length !== grid.n) fail(`La mappa ha ${data.length} celle, la zona ${grid.n}`);
  return Float32Array.from(data);
}

/** Griglia ASCII (UTM della zona) → arrivo sulle celle della zona, al più vicino. */
function fromAsc(path, factor) {
  const g = parseAsc(readFileSync(path, 'utf8'));
  const { x: x0, y: y0 } = grid.manifest.origin_utm, res = grid.res;
  const out = new Float32Array(grid.n).fill(Infinity);
  let inside = 0;
  for (let r = 0; r < grid.rows; r++) {
    const y = y0 - (r + 0.5) * res, gr = Math.floor((g.ymax - y) / g.cell);
    if (gr < 0 || gr >= g.nrows) continue;
    for (let c = 0; c < grid.cols; c++) {
      const x = x0 + (c + 0.5) * res, gc = Math.floor((x - g.xll) / g.cell);
      if (gc < 0 || gc >= g.ncols) continue;
      inside++;
      const v = g.data[gr * g.ncols + gc];
      if (Number.isFinite(v) && v >= 0) out[r * grid.cols + c] = v * factor;
    }
  }
  if (inside < grid.n * 0.5) fail(`La griglia ASCII copre solo ${(100 * inside / grid.n).toFixed(0)}% della zona: controlla sistema di riferimento ed estensione`);
  return out;
}
