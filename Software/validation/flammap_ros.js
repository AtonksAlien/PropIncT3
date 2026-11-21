#!/usr/bin/env node
// Velocità di propagazione per modello di combustibile: PropInc contro FlamMap con gli stessi ingressi
// (caso <caso>-flammap: vento e umidità costanti). Mostra anche il rapporto se il fattore di riduzione del
// vento (WAF) dei combustibili scoperti fosse fisso a --waf (default 0,4) invece che dipendere dallo spessore.
//
//   node validation/flammap_ros.js --case siniscola-2019 --ros data/zones/siniscola/flammap/risultati/ros_flammap.asc
//
// La griglia di FlamMap deve avere la stessa griglia della zona (come quelle preparate da flammap_prep.js).
// ATTENZIONE: la griglia «MTT ROS» di FlamMap è la velocità lungo il percorso di tempo minimo (guida di FlamMap 6.2), non la velocità della testa (a Dualchi il
// rapporto è circa 0,39 per tutti i combustibili mentre i tempi di arrivo coincidono), cioè la velocità
// lungo il percorso effettivo. Lo strumento resta come diagnostica; la verifica usa i tempi di arrivo.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { parseFuelModels } from '../engine/fuels.js';
import { spreadField, CANOPY } from '../engine/spreadfield.js';
import { parseAsc } from '../engine/windfield.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { case: null, ros: null, waf: 0.4 };
const argv = process.argv.slice(2);
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
if (!args.case || !args.ros) { console.error('Uso: node validation/flammap_ros.js --case <caso> --ros <ros_flammap.asc>'); process.exit(1); }

const eq = JSON.parse(readFileSync(join(ROOT, 'config', 'validation', `${args.case}-flammap.json`), 'utf8'));
const grid = loadZone(join(ROOT, 'data', 'zones', eq.zone, 'processed'));
const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline', 'tables', 'fuel_models.csv'), 'utf8'));
const fm = parseAsc(readFileSync(resolve(args.ros), 'utf8'));
if (fm.ncols !== grid.cols || fm.nrows !== grid.rows) throw new Error('La griglia di FlamMap non coincide con quella della zona');
const wind = (s) => ({ ws10: s, from: eq.wind.from, gust: s });
const base = spreadField(grid, models, eq.moisture, wind(eq.wind.speed));
const med = (v) => { v = [...v].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
const waf = Number(args.waf), rows = [];
for (let k = 1; k <= 13; k++) {
  const cells = [];
  for (let i = 0; i < grid.n; i++) if (grid.fuel[i] === k && Number.isFinite(fm.data[i]) && fm.data[i] >= 0) cells.push(i);
  if (!cells.length) continue;
  const sheltered = CANOPY.models.includes(k);
  // stesso vento a metà fiamma che darebbe un WAF fisso: si scala il vento a 10 m del rapporto tra i due WAF
  const alt = sheltered ? null : spreadField(grid, models, eq.moisture, wind(eq.wind.speed * (waf / base.waf[k])));
  rows.push({ model: k, cells: cells.length, wafPropInc: base.waf[k], rosPropInc: med(cells.map((i) => base.ros[i])), rosFlamMap: med(cells.map((i) => fm.data[i])),
    ratio: med(cells.map((i) => fm.data[i] / Math.max(base.ros[i], 1e-6))),
    ratioFixedWaf: alt ? med(cells.map((i) => fm.data[i] / Math.max(alt.ros[i], 1e-6))) : null, sheltered });
}
console.log(`Velocità di propagazione (m/min, mediana per modello), ${args.case}, vento ${eq.wind.speed} m/s da ${eq.wind.from}°`);
console.log('mod  celle   WAF PropInc  PropInc  FlamMap  FlamMap/PropInc  con WAF fisso ' + waf);
for (const r of rows) {
  console.log(`${String(r.model).padStart(3)} ${String(r.cells).padStart(7)} ${r.wafPropInc.toFixed(3).padStart(10)} ${r.rosPropInc.toFixed(2).padStart(8)} ${r.rosFlamMap.toFixed(2).padStart(8)} ${r.ratio.toFixed(3).padStart(16)} ${r.ratioFixedWaf === null ? '   (sotto chioma)' : r.ratioFixedWaf.toFixed(3).padStart(14)}`);
}
const out = join(ROOT, 'data', 'zones', eq.zone, 'validation', args.case, 'flammap', 'velocita.json');
writeFileSync(out, JSON.stringify({ case: args.case, ros: resolve(args.ros), fixedWaf: waf, models: rows }, null, 2));
console.log(`\nRisultati in ${out}`);
