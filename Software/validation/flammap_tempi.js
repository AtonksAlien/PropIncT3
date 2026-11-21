#!/usr/bin/env node
// Tempo di calcolo e precisione di PropInc sulla stessa griglia e la stessa durata dei run di FlamMap (24 h),
// da eseguire sullo stesso PC su cui è stato eseguito FlamMap, per un confronto alla pari.
//
//   node validation/flammap_tempi.js --case siniscola-2019 [--ripetizioni 3] [--flammap-min 283]
//
// Misura, in un solo thread, la prima esecuzione («a freddo», come FlamMap che parte da zero: comprende il campo
// di vento sul rilievo, poi tenuto in memoria) e la mediana delle ripetizioni («a caldo»):
//   - PropInc con gli stessi ingressi di FlamMap (caso <caso>-flammap: vento e umidità costanti, senza strade)
//   - PropInc completo (meteo orario, vento a conservazione della massa con lo strato limite ERA5, barriere
//     attraversabili, umidità viva dall'NDVI)
// e per ciascuno il Sørensen ad area uguale contro l'incendio osservato. Scrive
// data/zones/<zona>/validation/<caso>/flammap/tempi.json. Il meteo viene dalla cache del repository (niente rete).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { loadZone } from '../engine/load-node.js';
import { parseFuelModels } from '../engine/fuels.js';
import { makeWeather, simulate } from '../engine/simulate.js';
import { fetchForSimulation, fetchBoundaryLayer } from '../backend/src/weather/openmeteo.js';
import { rasterizePerimeter } from './lib/perimeter.js';
import { areaMatchedMask, confusion } from './lib/metrics.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { case: null, ripetizioni: 3, 'flammap-min': null, durata: 1440 };
const argv = process.argv.slice(2);
if (argv.length && !argv[0].startsWith('--')) args.case = argv.shift();
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
if (!args.case) { console.error('Uso: node validation/flammap_tempi.js --case <caso> [--ripetizioni 3] [--flammap-min <minuti di FlamMap>]'); process.exit(1); }

const kase = JSON.parse(readFileSync(join(ROOT, 'config', 'validation', `${args.case}.json`), 'utf8'));
const eq = JSON.parse(readFileSync(join(ROOT, 'config', 'validation', `${args.case}-flammap.json`), 'utf8'));
const zoneCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'zones', `${kase.zone}.json`), 'utf8'));
const zdir = join(ROOT, 'data', 'zones', kase.zone);
const grid = loadZone(join(zdir, 'processed'));
const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline', 'tables', 'fuel_models.csv'), 'utf8'));
const perim = rasterizePerimeter(grid, JSON.parse(readFileSync(join(zdir, kase.perimeter), 'utf8')), { filter: kase.perimeter_filter ?? null });
const ign = (c) => JSON.parse(readFileSync(join(zdir, 'validation', c, 'metriche.json'), 'utf8')).ignitions;
const maxMin = Number(args.durata), reps = Number(args.ripetizioni);

const domain = new Uint8Array(grid.n);
let K = 0;
for (let i = 0; i < grid.n; i++) { domain[i] = grid.fuel[i] > 0 ? 1 : 0; if (perim.mask[i] && domain[i]) K++; }
const sorensen = (arrival) => confusion(perim.mask, areaMatchedMask(arrival, domain, K).mask, domain).sorensen;

// meteo dalla cache: stessa durata richiesta da validate.js, così il file in cache è lo stesso
const start = new Date(kase.start), cacheMin = Number(kase.hours ?? 24) * 60, cacheDir = join(zdir, 'raw', 'meteo');
const hourly = (await fetchForSimulation(zoneCfg.meteo_point_wgs84, start, cacheMin, { cacheDir })).json;
const blh = (await fetchBoundaryLayer(zoneCfg.meteo_point_wgs84, start, cacheMin, { cacheDir })).json;

const configs = [
  { name: 'PropInc, stessi ingressi di FlamMap', ignitions: ign(`${args.case}-flammap`),
    weather: () => makeWeather({ wind: eq.wind, durMin: maxMin, moist: eq.moisture }),
    job: { barriers: false, liveNdvi: false, terrainWind: false } },
  { name: 'PropInc completo', ignitions: ign(args.case),
    weather: () => makeWeather({ hourlyJson: hourly, start, durMin: maxMin, blhJson: blh }),
    job: { barriers: true, liveNdvi: true, terrainWind: { method: 'massa', blhM: 'era5' } } },
];

const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const results = [];
for (const c of configs) {
  const times = [];
  let s = null;
  for (let k = 0; k < reps; k++) {
    const wx = c.weather();
    const t0 = process.hrtime.bigint();
    const r = simulate(grid, models, { ignitions: c.ignitions, maxMin, ...c.job }, wx);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    s = sorensen(r.arrival);
  }
  results.push({ config: c.name, msCold: times[0], msMedian: median(times), msAll: times, sorensen: s });
  console.log(`${c.name.padEnd(38)} a freddo ${(times[0] / 1000).toFixed(2)} s, mediana ${(median(times) / 1000).toFixed(2)} s (${times.map((t) => (t / 1000).toFixed(2)).join(', ')})   Sørensen ${(100 * s).toFixed(1)}%`);
}
const fm = args['flammap-min'] !== null ? Number(args['flammap-min']) : null;
if (fm) for (const r of results) console.log(`  FlamMap / ${r.config} (a freddo): ${((fm * 60e3) / r.msCold).toFixed(0)} volte più lento`);

const cpu = cpus();
const out = { case: args.case, durationMin: maxMin, cells: grid.n, repetitions: reps, threads: 1,
  machine: { cpu: cpu[0]?.model ?? null, logicalCores: cpu.length, memoryGB: Math.round(totalmem() / 2 ** 30), node: process.version },
  flammapMin: fm, results, created: new Date().toISOString() };
const dir = join(zdir, 'validation', args.case, 'flammap');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'tempi.json'), JSON.stringify(out, null, 2));
console.log(`\nMacchina: ${out.machine.cpu} (${out.machine.logicalCores} thread logici), Node ${out.machine.node}\nRisultati in ${join(dir, 'tempi.json')}`);
