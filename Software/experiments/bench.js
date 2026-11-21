#!/usr/bin/env node
// Benchmark: tempo e memoria del modello (Rothermel + tempo di arrivo) su griglie da 250² a 2000² celle.
//
//   cd Software && node experiments/bench.js            (circa 1–2 minuti)
//
// Metodo
// - Griglie N × N ottenute replicando a specchio il pacchetto di Mercadante (600 × 600): paesaggio eterogeneo
//   come quello reale. Specchiando, l'esposizione dei versanti si trasforma di conseguenza.
// - Ogni prova gira in un processo separato: il picco di memoria (maxRSS) è solo di quella prova.
//   Tempo: mediana di 3 ripetizioni. Il tempo misurato è quello del modello (griglia già in memoria).
// - Casi: "fino a esaurimento" = innesco al centro, vento costante 5 m/s da 240°, umidità D2L2
//   (caso peggiore: brucia tutto il raggiungibile); "3 ore" = meteo reale del 25/07/2023 ore 13–16,
//   innesco nell'erba più vicino al centro (caso d'uso dell'interfaccia).
// Uscite: Documenti/figure/benchmark/ (SVG + CSV + risultati.json).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { parseFuelModels } from '../engine/fuels.js';
import { runMTT } from '../engine/mtt.js';
import { makeWeather, lazyFieldAt } from '../engine/simulate.js';
import { chart, csv } from './lib/svgchart.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '..', 'Documenti', 'figure', 'benchmark');
const SIZES = [250, 500, 1000, 1500, 2000];
const CASES = { C_tutta: 'fino a esaurimento', C_3ore: '3 ore, meteo reale' };
const REPEAT = 3;
const METEO = join(ROOT, 'data/zones/mercadante/raw/meteo/ecmwf_ifs_2023-07-22_2023-07-25_40.8818_16.6854.json');

/** Griglia N × N replicando a specchio la zona base; esposizione trasformata con il riflesso. */
function mirrorGrid(base, N) {
  const n = N * N, B = base.rows;
  const g = { rows: N, cols: N, res: base.res, n, manifest: base.manifest };
  for (const k of ['fuel', 'slope', 'aspect', 'tanSlope', 'elevation', 'ndvi']) g[k] = new base[k].constructor(n);
  for (let r = 0; r < N; r++) {
    const tr = Math.floor(r / B), fy = tr % 2 === 1, br = fy ? B - 1 - (r % B) : r % B;
    for (let c = 0; c < N; c++) {
      const tc = Math.floor(c / B), fx = tc % 2 === 1, bc = fx ? B - 1 - (c % B) : c % B;
      const i = r * N + c, j = br * B + bc;
      g.fuel[i] = base.fuel[j]; g.slope[i] = base.slope[j]; g.tanSlope[i] = base.tanSlope[j];
      g.elevation[i] = base.elevation[j]; g.ndvi[i] = base.ndvi[j];
      let a = base.aspect[j];
      if (a >= 0) { if (fx) a = (360 - a) % 360; if (fy) a = (540 - a) % 360; }   // riflesso Est-Ovest / Nord-Sud
      g.aspect[i] = a;
    }
  }
  return g;
}

/** Cella più vicina al centro con combustibile accettato da `ok` (default: qualsiasi combustibile). */
function centerIgnition(g, ok = (f) => f > 0) {
  const m = g.rows >> 1;
  for (let d = 0; d < g.rows; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
    const r = m + dr, c = m + dc;
    if (ok(g.fuel[r * g.cols + c])) return { r, c };
  }
}

// --- una prova (processo figlio): stampa una riga JSON
function one(caseName, N) {
  const base = loadZone(join(ROOT, 'data/zones/mercadante/processed'));
  const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  const g = N === base.rows ? base : mirrorGrid(base, N);
  // "C 3 ore": sempre un innesco nell'erba (modello 1), così il caso è confrontabile tra le dimensioni
  const ign = [caseName === "C_3ore" ? centerIgnition(g, (f) => f === 1) : centerIgnition(g)];
  const constant = makeWeather({ wind: { speed: 5, from: 240 } });
  const real = () => makeWeather({ hourlyJson: JSON.parse(readFileSync(METEO, 'utf8')), start: new Date('2023-07-25T13:00:00+02:00'), durMin: 180 });
  const t0 = performance.now();
  const lazy = lazyFieldAt(g, models, caseName === 'C_3ore' ? real() : constant);
  const r = runMTT(g, ign, lazy.fieldAt, { maxMin: caseName === 'C_3ore' ? 180 : 1e9 });
  const extra = { cellsComputed: lazy.field.computed, fieldSteps: lazy.steps() };
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ case: caseName, N, cells: g.n, ms, burned: r.burnedCells, maxRSSMB: process.resourceUsage().maxRSS / 1024, ...extra }));
}

if (process.argv[2] === '--one') { one(process.argv[3], Number(process.argv[4])); process.exit(0); }

// --- coordinamento
const self = fileURLToPath(import.meta.url);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// --charts: ridisegna le figure dai risultati salvati, senza ripetere le misure
const onlyCharts = process.argv[2] === '--charts';
const saved = onlyCharts ? JSON.parse(readFileSync(join(OUT, 'risultati.json'), 'utf8')) : null;
const machine = saved?.machine ?? { cpu: cpus()[0].model.trim(), cores: cpus().length, ramGB: +(totalmem() / 2 ** 30).toFixed(1), node: process.version, os: `${platform()} ${release()}` };
console.log(`Macchina: ${machine.cpu} · ${machine.cores} thread · ${machine.ramGB} GB · Node ${machine.node}`);
const rows = (saved?.rows ?? []).filter((r) => r.case in CASES);   // via le righe di casi non più misurati
if (!onlyCharts) for (const N of SIZES) for (const cs of Object.keys(CASES)) {
  const runs = [];
  for (let k = 0; k < REPEAT; k++) runs.push(JSON.parse(execFileSync(process.execPath, [self, '--one', cs, String(N)], { encoding: 'utf8', maxBuffer: 1 << 20 })));
  const r = { ...runs[0], ms: median(runs.map((x) => x.ms)), maxRSSMB: median(runs.map((x) => x.maxRSSMB)) };
  rows.push(r);
  console.log(`  ${String(N).padStart(4)}² ${cs.padEnd(8)} ${(r.ms / 1000).toFixed(2).padStart(6)} s  ${r.maxRSSMB.toFixed(0).padStart(5)} MB  bruciate ${r.burned}${r.cellsComputed ? `  campo calcolato in ${r.cellsComputed} celle` : ''}`);
}

mkdirSync(OUT, { recursive: true });
const series = (key) => Object.entries(CASES).map(([cs, name]) => ({ name, points: rows.filter((r) => r.case === cs).map((r) => [r.cells / 1e6, key(r), `${r.N}² celle: ${key === msOf ? (r.ms / 1000).toFixed(2) + ' s' : r.maxRSSMB.toFixed(0) + ' MB'}`]) }));
function msOf(r) { return r.ms / 1000; }
writeFileSync(join(OUT, 'b1_tempo.svg'), chart({
  title: 'Tempo di calcolo al crescere della griglia',
  subtitle: `${machine.cpu}, Node ${machine.node}; mediana di ${REPEAT} ripetizioni`,
  xLabel: 'Celle della griglia (milioni, scala log)', yLabel: 'Tempo (s, scala log)', xLog: true, yLog: true,
  xRange: [0.05, 5], yRange: [0.01, 20], series: series(msOf),
  note: 'griglie ottenute replicando Mercadante a specchio; 2000² celle = 20 × 20 km a 10 m',
}));
writeFileSync(join(OUT, 'b2_memoria.svg'), chart({
  title: 'Picco di memoria al crescere della griglia',
  subtitle: 'Memoria residente massima del processo (griglia + modello); un processo per prova',
  xLabel: 'Celle della griglia (milioni, scala log)', yLabel: 'Memoria (MB, scala log)', xLog: true, yLog: true,
  xRange: [0.05, 5], yRange: [50, 500], series: series((r) => r.maxRSSMB),
}));
writeFileSync(join(OUT, 'benchmark.csv'), csv(['caso', 'lato_celle', 'celle', 'tempo_s', 'picco_memoria_MB', 'celle_bruciate', 'celle_campo_calcolate'],
  rows.map((r) => [r.case, r.N, r.cells, r.ms / 1000, r.maxRSSMB, r.burned, r.cellsComputed ?? ''])));
writeFileSync(join(OUT, 'risultati.json'), JSON.stringify({ machine, repeat: REPEAT, rows, generato: saved?.generato ?? new Date().toISOString() }, null, 2));
console.log(`→ ${OUT}`);
