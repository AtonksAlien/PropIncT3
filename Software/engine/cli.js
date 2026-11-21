#!/usr/bin/env node
// Simulazione da riga di comando.
//
//   node engine/cli.js --date 2023-07-25T13:00+02:00 --hours 3 --png out/sim.png      (meteo reale)
//   node engine/cli.js --wind 6@270 --hours 2 --png out/c.png                        (vento costante)
//
// Modello: Rothermel + tempo minimo di arrivo (Dijkstra su 16 direzioni).
// --ignite  "E,N" in UTM 33N, "lat,lon" se preceduto da "@" (es. @40.88,16.68), oppure "r:c" come riga:colonna;
//           più inneschi separati da ";" (default: centro della pineta)
// --wind    "velocità@provenienza" in m/s e gradi da Nord (convenzione meteo), es. 5@270 = 5 m/s da Ovest
// --date    istante dell'innesco (ISO 8601): meteo reale Open-Meteo, vento e umidità variabili (ignora --wind)
// --ros     immagine della velocità di Rothermel all'istante dell'innesco
// --hours   durata simulata
// --png     immagine del tempo di arrivo
// --zone    zona (default mercadante)
// --barriers on|off  strade asfaltate, ferrovie e acqua da OpenStreetMap fermano il fuoco (default on, se il layer esiste)
//
// La simulazione vera e propria è in engine/simulate.js, la stessa usata dal worker del server.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from './load-node.js';
import { utmToCell, latLonToCell } from './grid.js';
import { renderArrival, renderRos } from './render.js';
import { parseFuelModels } from './fuels.js';
import { encodePNG } from './png.js';
import { makeWeather, simulate, burnedByHour, fullFieldAt } from './simulate.js';
import { fetchForSimulation } from '../backend/src/weather/openmeteo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_IGNITION = '641942,4527290';  // centro della pineta (Notion «Dati grezzi» §1)

const args = { zone: 'mercadante', ignite: DEFAULT_IGNITION, wind: '0@0', date: null, ros: null, hours: 3, png: null, barriers: 'on' };
const argv = process.argv.slice(2);
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
const maxMin = Number(args.hours) * 60;

const grid = loadZone(join(ROOT, 'data', 'zones', args.zone, 'processed'));
const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline', 'tables', 'fuel_models.csv'), 'utf8'));
const ignitions = String(args.ignite).split(';').map((s) => {
  if (s.includes(':')) { const [r, c] = s.split(':').map(Number); return { r, c }; }
  if (s.startsWith('@')) { const [lat, lon] = s.slice(1).split(',').map(Number); return latLonToCell(grid, lat, lon); }
  const [x, y] = s.split(',').map(Number);
  return utmToCell(grid, x, y);
});

console.log(`Zona ${grid.manifest.name}: ${grid.rows}x${grid.cols} celle da ${grid.res} m`);
console.log(`Innesco: ${ignitions.map(({ r, c }) => `r${r} c${c} (combustibile ${grid.fuel[r * grid.cols + c]})`).join(', ')}`);

const wx = args.date ? await realWeather(new Date(args.date)) : constantWeather();
const barriers = args.barriers !== 'off';
console.log(grid.barriers ? `Barriere OSM: ${barriers ? 'attive' : 'disattivate'}` : 'Barriere OSM: layer assente (node pipeline/barriers.js)');
const job = { ignitions, maxMin, barriers };

const r = simulate(grid, models, job, wx);
console.log(`\nRothermel + tempo di arrivo (Dijkstra 16 direzioni): ${r.burnedHa.toFixed(1)} ha in ${r.ms.toFixed(0)} ms (campi di Rothermel calcolati: ${r.fields})`);
console.log(`  estensione dall'innesco: ${extent(r.arrival)}`);
console.log(`  area bruciata nel tempo: ${burnedByHour(grid, r.arrival, maxMin).map((ha, h) => `${h + 1} h: ${ha.toFixed(1)} ha`).join(' · ')}`);

if (args.ros) {
  const f = fullFieldAt(grid, models, wx, 0);
  console.log(`\nRothermel all'innesco:\n  modello  celle    WAF   R0 m/min  mediana m/min  max m/min`);
  const byModel = {};
  for (let i = 0; i < grid.n; i++) (byModel[grid.fuel[i]] ??= []).push(f.ros[i]);
  for (const [k, v] of Object.entries(byModel)) {
    if (k === '0') { console.log(`  0 (non combustibile) ${v.length}`); continue; }
    v.sort((a, b) => a - b);
    console.log(`  ${k.padStart(2)}       ${String(v.length).padStart(6)}  ${f.waf[k].toFixed(2)}  ${(f.beds[k].R0 * 0.3048).toFixed(2).padStart(8)}  ${v[v.length >> 1].toFixed(1).padStart(12)}  ${v[v.length - 1].toFixed(1).padStart(9)}`);
  }
  save(args.ros, renderRos(grid, f.ros), 'Mappa velocità');
}
if (args.png) save(args.png, renderArrival(grid, r.arrival, maxMin, ignitions), 'Tempo di arrivo');

// ---------------------------------------------------------------------------------------------

function save(file, rgb, label) {
  const out = resolve(process.cwd(), file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(rgb, grid.cols, grid.rows));
  console.log(`${label}: ${out}`);
}

/** Distanza massima raggiunta dal primo innesco nelle 4 direzioni cardinali. */
function extent(arrival) {
  const { r: r0, c: c0 } = ignitions[0];
  const e = { N: 0, S: 0, E: 0, O: 0 };
  for (let i = 0; i < grid.n; i++) {
    if (!Number.isFinite(arrival[i])) continue;
    const r = (i / grid.cols) | 0, c = i % grid.cols;
    e.N = Math.max(e.N, r0 - r); e.S = Math.max(e.S, r - r0); e.E = Math.max(e.E, c - c0); e.O = Math.max(e.O, c0 - c);
  }
  return Object.entries(e).map(([k, v]) => `${k} ${v * grid.res} m`).join(' · ');
}

function constantWeather() {
  const [speed, from] = String(args.wind).split('@').map(Number);
  console.log(`Vento costante: ${speed} m/s da ${from}° (soffia verso ${(from + 180) % 360}°)`);
  console.log('Umidità (scenario D2L2 di Scott & Burgan): morta 6/7/8% · viva erbacea 60%, legnosa 90%');
  return makeWeather({ wind: { speed, from }, durMin: maxMin });
}

/** Serie oraria Open-Meteo (dalla cache se c'è) e riepilogo stampato. */
async function realWeather(start) {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'zones', `${args.zone}.json`), 'utf8'));
  const r = await fetchForSimulation(cfg.meteo_point_wgs84, start, maxMin,
    { cacheDir: join(ROOT, 'data', 'zones', args.zone, 'raw', 'meteo') });
  const wx = makeWeather({ hourlyJson: r.json, start, durMin: maxMin });
  console.log(`Meteo: Open-Meteo ${r.source}, modello ${r.model}${r.fromCache ? ' (cache)' : ''}`);
  console.log('  ora UTC  °C    UR%  vento m/s  da    raffica  umidità 1h');
  for (const h of wx.hourly) {
    console.log(`  ${h.t.slice(11, 16)}    ${h.temp.toFixed(1).padStart(4)}  ${h.rh.toFixed(0).padStart(3)}  ${h.windSpeed.toFixed(1).padStart(5)}      ${h.windFrom.toFixed(0).padStart(3)}°  ${h.gust.toFixed(1).padStart(5)}    ${(h.m1 * 100).toFixed(1)}%`);
  }
  console.log(`Umidità viva: scenario ${wx.live} di Scott & Burgan`);
  return wx;
}
