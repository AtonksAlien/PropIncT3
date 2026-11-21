#!/usr/bin/env node
// Esperimenti di sensibilità del modello (Rothermel + tempo di arrivo). Riproducibili: inneschi fissi, meteo dalla cache.
//
//   cd Software && node experiments/run.js            (tutti, circa 10 secondi)
//   node experiments/run.js e1 e3                       (solo alcuni)
//
// Uscite in Documenti/figure/esperimenti/: una figura SVG e una tabella CSV per esperimento,
// più risultati.json con i numeri citati in Notion «Esperimenti».

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBarriers } from '../engine/grid.js';
import { loadZone } from '../engine/load-node.js';
import { parseFuelModels } from '../engine/fuels.js';
import { fuelbed, spread, windAdjustmentFactor, midflameFtMin, FT_TO_M } from '../engine/rothermel.js';
import { spreadField, CANOPY } from '../engine/spreadfield.js';
import { runMTT } from '../engine/mtt.js';
import { makeWeather, compareArrivals, FIELD_STEP_MIN } from '../engine/simulate.js';
import { LIVE_SCENARIOS } from '../engine/weather.js';
import { chart, csv } from './lib/svgchart.js';
import { rng } from './lib/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '..', 'Documenti', 'figure', 'esperimenti');
const MODELS = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
const SUMMER = { m1: 0.06, m10: 0.07, m100: 0.08, ...LIVE_SCENARIOS.L1 };   // morti D2, vivi L1 (estate)
const results = {};
mkdirSync(OUT, { recursive: true });
const save = (name, svg, header, rows) => {
  writeFileSync(join(OUT, `${name}.svg`), svg);
  writeFileSync(join(OUT, `${name}.csv`), csv(header, rows));
  console.log(`  → ${name}.svg, ${name}.csv`);
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

// --- velocità della testa (Rothermel, come in spreadfield.js) — m/min
function rosC(fuel, moist, ws10, { tanSlope = 0, aspect = -1, windFrom = 270, canopy = CANOPY } = {}) {
  const m = MODELS[fuel].us, fb = fuelbed(m, moist);
  const waf = canopy && canopy.models.includes(fuel)
    ? windAdjustmentFactor(m.depth, canopy.cover, canopy.heightM / FT_TO_M, canopy.crownRatio)
    : windAdjustmentFactor(m.depth);
  return spread(fb, midflameFtMin(ws10, waf), (windFrom + 180) % 360, tanSlope, aspect).ros * FT_TO_M;
}

const EXP = {
  e1() {
    console.log('E1 — vento');
    const rows = [], s = { Ce: [], Cp: [], Cm: [] };
    for (let w = 0; w <= 12; w++) {
      const ce = rosC(1, SUMMER, w), cm = rosC(4, SUMMER, w), cp = rosC(10, SUMMER, w);
      rows.push([w, ce, cm, cp]);
      s.Ce.push([w, ce]); s.Cm.push([w, cm]); s.Cp.push([w, cp]);
    }
    results.e1 = { rows };
    save('e1_vento', chart({
      title: 'Velocità della testa del fuoco al variare del vento',
      subtitle: 'Terreno piano; vento a 10 m da Ovest; umidità morta 6/7/8%, viva L1',
      xLabel: 'Vento a 10 m (m/s)', yLabel: 'Velocità della testa (m/min, scala log)', yLog: true, yRange: [0.1, 300],
      series: [{ name: 'erba (1)', points: s.Ce }, { name: 'macchia (4)', points: s.Cm }, { name: 'pineta (10)', points: s.Cp }],
    }), ['vento_m_s', 'erba1_m_min', 'macchia4_m_min', 'pineta10_m_min'], rows);
  },

  e2() {
    console.log('E2 — pendenza');
    const rows = [], s = { Ce: [], Cm: [], Cp: [] };
    for (let d = 0; d <= 30; d += 2.5) {
      const t = Math.tan((d * Math.PI) / 180);
      const o = { tanSlope: t, aspect: 180 };
      const ce = rosC(1, SUMMER, 0, o), cm = rosC(4, SUMMER, 0, o), cp = rosC(10, SUMMER, 0, o);
      rows.push([d, ce, cm, cp]);
      s.Ce.push([d, ce]); s.Cm.push([d, cm]); s.Cp.push([d, cp]);
    }
    results.e2 = { rows };
    save('e2_pendenza', chart({
      title: 'Velocità in salita al variare della pendenza',
      subtitle: 'Senza vento; umidità morta 6/7/8%, viva L1',
      xLabel: 'Pendenza (gradi)', yLabel: 'Velocità verso monte (m/min)',
      series: [{ name: 'erba (1)', points: s.Ce }, { name: 'macchia (4)', points: s.Cm }, { name: 'pineta (10)', points: s.Cp }],
    }), ['pendenza_gradi', 'erba1_m_min', 'macchia4_m_min', 'pineta10_m_min'], rows);
  },

  e3() {
    console.log('E3 — umidità del combustibile morto');
    const rows = [], s = { C1: [], C2: [], C4: [], C10: [] };
    for (let m = 2; m <= 16; m++) {
      const moist = { ...SUMMER, m1: m / 100, m10: (m + 1) / 100, m100: (m + 2) / 100 };
      const c1 = rosC(1, moist, 5), c2 = rosC(2, moist, 5), c4 = rosC(4, moist, 5), c10 = rosC(10, moist, 5);
      rows.push([m, c1, c2, c4, c10]);
      s.C1.push([m, c1]); s.C2.push([m, c2]); s.C4.push([m, c4]); s.C10.push([m, c10]);
    }
    results.e3 = { rows };
    save('e3_umidita', chart({
      title: 'Velocità della testa al variare dell\'umidità del combustibile morto',
      subtitle: 'Vento 5 m/s, terreno piano; umidità 10h e 100h = 1h + 1 e + 2 punti; viva L1',
      xLabel: 'Umidità del combustibile fine morto, 1h (%)', yLabel: 'Velocità della testa (m/min)', xTicks: 7,
      series: [{ name: 'erba (1)', points: s.C1 }, { name: 'erba rada (2)', points: s.C2 },
        { name: 'macchia (4)', points: s.C4 }, { name: 'pineta (10)', points: s.C10 }],
      note: 'Estinzione morta: modello 1 al 12%, modello 2 al 15%, modello 4 al 20%, modello 10 al 25%',
    }), ['umidita_1h_pct', 'erba1_m_min', 'erba2_m_min', 'macchia4_m_min', 'pineta10_m_min'], rows);
  },

  e4() {
    console.log('E4 — chiome della pineta (assunzione D18)');
    const moist = real().wx.at(0).moist, ws = real().wx.at(0).ws10;
    const rows = [], series = [];
    for (const [k, h] of [8, 12, 16].entries()) {
      const pts = [];
      for (const cover of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        const v = rosC(10, moist, ws, { canopy: { ...CANOPY, cover, heightM: h } });
        rows.push([cover * 100, h, v]); pts.push([cover * 100, v]);
      }
      series.push({ name: `chiome alte ${h} m`, points: pts });
    }
    const open = rosC(10, moist, ws, { canopy: null });
    results.e4 = { rows, unsheltered: open, assumed: rosC(10, moist, ws) };
    save('e4_chiome', chart({
      title: 'Pineta: velocità della testa al variare delle chiome',
      subtitle: `25/07/2023 ore 13: vento ${ws.toFixed(1)} m/s, umidità 1h ${(moist.m1 * 100).toFixed(1)}%; crown ratio 0,5`,
      xLabel: 'Copertura delle chiome (%)', yLabel: 'Velocità della testa (m/min)', yRange: [0, Math.ceil(open)],
      series, hlines: [{ y: open, label: `senza riparo delle chiome: ${open.toFixed(1)} m/min` }],
      note: 'in uso (D18): copertura 50%, altezza 12 m. Al 30% (crown ratio 0,5) Behave non applica il riparo',
    }), ['copertura_pct', 'altezza_m', 'pineta_m_min'], [...rows, ['senza riparo', '', open]]);
  },

  e5() {
    console.log('E5 — barriere OSM (strade asfaltate e acqua)');
    const { grid, ign, cAreas, cArr } = realRuns();
    if (!grid.barriers) { console.log('  layer barriers assente: eseguire node pipeline/barriers.js'); return; }
    const gb = withBarriers(grid);
    const { wx } = real();
    const fb = new Map();   // campi di Rothermel sulla griglia con barriere (condivisi tra inneschi)
    const fieldB = (t) => {
      const k = Math.floor(t / FIELD_STEP_MIN);
      if (!fb.has(k)) { const w = wx.at(k * FIELD_STEP_MIN); fb.set(k, spreadField(gb, MODELS, w.moist, { ws10: w.ws10, from: w.from, gust: w.gust }, { liveNdvi: true })); }
      return fb.get(k);
    };
    const rows = [], s = { erba: [], bosco: [] };
    for (const p of ign) {
      if (gb.fuel[p.r * 600 + p.c] === 0) continue;   // innesco proprio su una strada: escluso
      const cB = runMTT(gb, [p], fieldB, { maxMin: 180 });
      const off = cAreas[p.key], on = cB.burnedHa, sor = compareArrivals(cArr[p.key], cB.arrival).sorensen;
      rows.push([`r${p.r} c${p.c}`, p.cls, off, on, (on - off) / Math.max(off, 0.01), sor]);
      s[p.cls].push([Math.max(off, 1), Math.max(on, 1), `r${p.r} c${p.c}: ${off.toFixed(1)} → ${on.toFixed(1)} ha`]);
    }
    const rel = rows.map((r) => r[4]);
    results.e5 = {
      n: rows.length, barrierStats: grid.manifest.barriers,
      medianOff: median(rows.map((r) => r[2])), medianOn: median(rows.map((r) => r[3])), medianRelChange: median(rel),
      reducedOver25: rel.filter((v) => v < -0.25).length, unchanged: rel.filter((v) => Math.abs(v) < 0.01).length, minRelChange: Math.min(...rel),
    };
    save('e5_barriere', chart({
      title: 'Effetto delle barriere OSM sull\'area bruciata in 3 ore',
      subtitle: 'Strade asfaltate e acqua non combustibili; 30 inneschi casuali, 25/07/2023 ore 13–16, meteo reale',
      xLabel: 'Senza barriere (ha, scala log)', yLabel: 'Con le barriere (ha, scala log)', xLog: true, yLog: true,
      xRange: [1, 2000], yRange: [1, 2000], lines: false, diagonal: true, noEndLabels: true,
      series: [{ name: 'innesco nelle stoppie o nei prati (1, 2)', points: s.erba }, { name: 'innesco nel bosco (8, 9, 10)', points: s.bosco }],
      note: 'sotto la diagonale = la barriera riduce l\'area; aree sotto 1 ha mostrate a 1 ha',
    }), ['innesco', 'classe', 'senza_ha', 'con_ha', 'variazione_relativa', 'sorensen_con_senza'], rows);
  },
};

// --- caso reale (Mercadante, 25/07/2023 ore 13, 3 ore), preparato una volta e condiviso tra E4 ed E5
let REAL = null;
function real() {
  if (REAL) return REAL;
  const grid = loadZone(join(ROOT, 'data/zones/mercadante/processed'));
  const cache = join(ROOT, 'data/zones/mercadante/raw/meteo', 'ecmwf_ifs_2023-07-22_2023-07-25_40.8818_16.6854.json');
  const start = new Date('2023-07-25T13:00:00+02:00');
  const wx = makeWeather({ hourlyJson: JSON.parse(readFileSync(cache, 'utf8')), start, durMin: 180 });
  const fields = new Map();
  const fieldAt = (t) => {   // stesso meteo per tutti gli inneschi: campi di Rothermel calcolati una volta
    const k = Math.floor(t / FIELD_STEP_MIN);
    if (!fields.has(k)) { const w = wx.at(k * FIELD_STEP_MIN); fields.set(k, spreadField(grid, MODELS, w.moist, { ws10: w.ws10, from: w.from, gust: w.gust }, { liveNdvi: true })); }
    return fields.get(k);
  };
  REAL = { grid, wx, fieldAt };
  return REAL;
}
let RUNS = null;
function realRuns() {
  if (RUNS) return RUNS;
  const { grid, fieldAt } = real();
  // 30 inneschi casuali (seme 2026), 15 nell'erba (modelli 1, 2) e 15 nel bosco (8, 9, 10), lontani dai bordi
  const rand = rng(2026), ign = [], want = { erba: 15, bosco: 15 };
  while (want.erba + want.bosco > 0) {
    const r = 30 + Math.floor(rand() * 540), c = 30 + Math.floor(rand() * 540), f = grid.fuel[r * 600 + c];
    const cls = f === 1 || f === 2 ? 'erba' : f >= 8 && f <= 10 ? 'bosco' : null;
    if (!cls || want[cls] === 0) continue;
    want[cls]--; ign.push({ r, c, fuel: f, cls, ndvi: grid.ndvi[r * 600 + c], key: `${r}_${c}` });
  }
  const cAreas = {}, cArr = {};
  const t0 = performance.now();
  for (const p of ign) { const r = runMTT(grid, [p], fieldAt, { maxMin: 180 }); cAreas[p.key] = r.burnedHa; cArr[p.key] = r.arrival; }
  console.log(`  ${ign.length} inneschi: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  RUNS = { grid, ign, cAreas, cArr };
  return RUNS;
}

const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EXP);
const t0 = performance.now();
for (const k of which) EXP[k]();
let prev = {};
try { prev = JSON.parse(readFileSync(join(OUT, 'risultati.json'), 'utf8')); } catch { /* prima esecuzione */ }
for (const k of ['e6', 'e7']) delete prev[k];   // esperimenti della vecchia numerazione, non più generati
writeFileSync(join(OUT, 'risultati.json'), JSON.stringify({ ...prev, ...results, generato: new Date().toISOString() }, null, 2));
// pagina per sfogliare le figure (ridimensionate alla finestra)
const figs = ['e1_vento', 'e2_pendenza', 'e3_umidita', 'e4_chiome', 'e5_barriere'];
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Esperimenti PropInc</title>
<style>body{margin:0;padding:16px;background:#fcfcfb;color:#0b0b0b;font-family:system-ui,sans-serif}figure{margin:0 0 28px;max-width:720px}figure svg{width:100%;height:auto;display:block;border:1px solid #e4e3de}figcaption{font-size:13px;color:#52514e;margin-top:4px}</style></head><body>
<h1 style="font-size:20px">Esperimenti di sensibilità</h1><p style="color:#52514e;font-size:13px">Generati da <code>Software/experiments/run.js</code>; dati nei file CSV accanto a ogni figura.</p>
${figs.map((f) => { let svg = ''; try { svg = readFileSync(join(OUT, `${f}.svg`), 'utf8'); } catch { return ''; } return `<figure>${svg.replace(/ width="\d+" height="\d+"/, '')}<figcaption>${f}.svg · dati in ${f}.csv</figcaption></figure>`; }).join('\n')}
</body></html>\n`);
console.log(`Fatto in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${OUT}`);
