#!/usr/bin/env node
// Prepara gli ingressi di FlamMap 6 (MTT, Finney 2002) per un caso di validazione, con gli stessi dati di PropInc,
// e il caso PropInc "equivalente" con gli stessi ingressi semplificati (verifica codice contro codice).
//
//   node validation/flammap_prep.js --case siniscola-2019
//
// Uscita in data/zones/<zona>/flammap/<caso>/:
//   elevation.asc, slope.asc, aspect.asc, fuel.asc, cover.asc, height.asc, cbh.asc, cbd.asc (+ .prj)
//                       temi del paesaggio, da unire in un file .lcp dentro FlamMap
//   umidita.fms         umidità dei combustibili per modello (percento)
//   innesco.shp/.shx/.dbf/.prj   punto di innesco (UTM della zona)
//   LEGGIMI.md          valori da inserire nella finestra MTT e passi da seguire
// e config/validation/<caso>-flammap.json: PropInc con vento costante, umidità costanti, senza vento sul terreno,
// senza strade e senza NDVI, cioè con quello che FlamMap riceve.
//
// Opzioni: --finestra 360 (minuti dopo l'innesco su cui mediare vento e umidità)
//          --vento-mph <n>  vento a 20 ft davvero inserito in FlamMap (accetta solo interi); default: il più vicino

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { cellToLatLon } from '../engine/grid.js';
import { makeWeather } from '../engine/simulate.js';
import { CANOPY } from '../engine/spreadfield.js';
import { LIVE_SCENARIOS, liveScenarioFor } from '../engine/weather.js';
import { fetchForSimulation } from '../backend/src/weather/openmeteo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { case: null, finestra: 360, 'vento-mph': null };
const argv = process.argv.slice(2);
if (argv.length && !argv[0].startsWith('--')) args.case = argv.shift();
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
if (!args.case) { console.error('Uso: node validation/flammap_prep.js --case <nome>'); process.exit(1); }

const kase = JSON.parse(readFileSync(join(ROOT, 'config', 'validation', `${args.case}.json`), 'utf8'));
const zoneCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'zones', `${kase.zone}.json`), 'utf8'));
const zdir = join(ROOT, 'data', 'zones', kase.zone);
const grid = loadZone(join(zdir, 'processed'));
const { rows, cols, res } = grid, { x: X0, y: Y0 } = grid.manifest.origin_utm;
const epsg = Number(grid.manifest.crs.split(':')[1]);
if (epsg < 32601 || epsg > 32660) throw new Error(`Sistema di riferimento non UTM nord: ${grid.manifest.crs}`);
const out = join(zdir, 'flammap', args.case);
mkdirSync(out, { recursive: true });

// --- innesco: la stessa cella usata da validate.js (già spostata sul combustibile) -------------------
const met = JSON.parse(readFileSync(join(zdir, 'validation', args.case, 'metriche.json'), 'utf8'));
const ign = met.ignitions[0];
const ix = X0 + (ign.c + 0.5) * res, iy = Y0 - (ign.r + 0.5) * res;

// --- meteo: media sulla finestra di propagazione principale ------------------------------------------
const start = new Date(kase.start), win = Number(args.finestra);
// stessa durata di validate.js: stesso file in cache
const r = await fetchForSimulation(zoneCfg.meteo_point_wgs84, start, Number(kase.hours ?? 24) * 60, { cacheDir: join(zdir, 'raw', 'meteo') });
const wx = makeWeather({ hourlyJson: r.json, start, durMin: win });
let n = 0, sp = 0, ue = 0, vn = 0, m1 = 0, m10 = 0, m100 = 0;
for (let t = 0; t <= win; t += 10) {
  const w = wx.at(t), to = ((w.from + 180) * Math.PI) / 180;
  n++; sp += w.ws10; ue += w.ws10 * Math.sin(to); vn += w.ws10 * Math.cos(to);
  m1 += w.moist.m1; m10 += w.moist.m10; m100 += w.moist.m100;
}
const ws10 = sp / n, from = ((Math.atan2(ue, vn) * 180) / Math.PI + 180 + 360) % 360;
const live = LIVE_SCENARIOS[liveScenarioFor(start)];
const moist = { m1: m1 / n, m10: m10 / n, m100: m100 / n, herb: live.herb, woody: live.woody };
const ws20exact = ws10 / 1.15;   // 10 m → 20 ft, come in Behave e in engine/rothermel.js
// FlamMap accetta solo velocità intere (mph a 20 ft) e umidità intere (%): il caso PropInc equivalente usa
// esattamente i valori arrotondati che riceve FlamMap
const mph = args['vento-mph'] !== null ? Number(args['vento-mph']) : Math.round(ws20exact / 0.44704);
const ws20 = mph * 0.44704, ws10fm = ws20 * 1.15;
for (const k of Object.keys(moist)) moist[k] = Math.round(moist[k] * 100) / 100;

// --- temi del paesaggio in griglia ASCII ----------------------------------------------------------
const prj = utmPrj(epsg - 32600);
const header = `ncols ${cols}\nnrows ${rows}\nxllcorner ${X0}\nyllcorner ${Y0 - rows * res}\ncellsize ${res}\nNODATA_value -9999\n`;
function asc(name, f, digits = 0) {
  const lines = [header];
  for (let r0 = 0; r0 < rows; r0++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = f(r0 * cols + c).toFixed(digits);
    lines.push(row.join(' ') + '\n');
  }
  writeFileSync(join(out, `${name}.asc`), lines.join(''));
  writeFileSync(join(out, `${name}.prj`), prj);
}
const canopy = (i) => CANOPY.models.includes(grid.fuel[i]);
asc('elevation', (i) => grid.elevation[i], 1);
asc('slope', (i) => Math.max(0, grid.slope[i]));
asc('aspect', (i) => (grid.aspect[i] < 0 ? 0 : grid.aspect[i]));
asc('fuel', (i) => (grid.fuel[i] > 0 ? grid.fuel[i] : 99));                 // 99 = non combustibile
asc('cover', (i) => (canopy(i) ? CANOPY.cover * 100 : 0));                 // %
asc('height', (i) => (canopy(i) ? CANOPY.heightM : 0), 1);                  // m
asc('cbh', (i) => (canopy(i) ? CANOPY.heightM * (1 - CANOPY.crownRatio) : 0), 1);   // m
asc('cbd', () => 0, 2);                                                      // kg/m³: niente fuoco di chioma, come PropInc

// --- umidità per modello (FlamMap .fms: modello 1h 10h 100h erbacee legnose, in percento) ------------
const pct = (x) => Math.round(x * 100);
const fms = [];
for (let k = 1; k <= 13; k++) fms.push(`${k} ${pct(moist.m1)} ${pct(moist.m10)} ${pct(moist.m100)} ${pct(moist.herb)} ${pct(moist.woody)}`);
writeFileSync(join(out, 'umidita.fms'), fms.join('\r\n') + '\r\n');

// --- punto di innesco in shapefile -----------------------------------------------------------------
writePointShapefile(join(out, 'innesco'), ix, iy);
writeFileSync(join(out, 'innesco.prj'), prj);

// --- caso PropInc con gli stessi ingressi di FlamMap -----------------------------------------------
const eq = {
  ...kase, case: `${args.case}-flammap`,
  name: `${kase.name} — ingressi di FlamMap (vento e umidità costanti, senza strade, NDVI e vento sul terreno)`,
  // lo stesso punto dello shapefile (centro della cella usata da validate.js per il caso originale)
  ignitions_wgs84: [[round(cellToLatLon(grid, ign.r, ign.c).lat, 6), round(cellToLatLon(grid, ign.r, ign.c).lon, 6)]], wind: { speed: round(ws10fm, 3), from: Math.round(from) }, moisture: moist,
  barriers: false, live_ndvi: false, terrain_wind: 'off',
  flammap_note: `Generato da validation/flammap_prep.js: medie su ${win} min dall'innesco, meteo Open-Meteo ${r.model}; vento medio a 10 m ${round(ws10, 2)} m/s, in FlamMap ${mph} mph a 20 ft (= ${round(ws10fm, 3)} m/s a 10 m); umidità arrotondate al punto percentuale come nel file .fms.`,
};
writeFileSync(join(ROOT, 'config', 'validation', `${args.case}-flammap.json`), JSON.stringify(eq, null, 2) + '\n');

const T = Number(kase.hours ?? 24) * 60;
writeFileSync(join(out, 'LEGGIMI.md'), `# FlamMap 6 — ${kase.name}

File preparati da \`validation/flammap_prep.js\` con i dati di PropInc. Sistema di riferimento: ${grid.manifest.crs}
(WGS 84 / UTM ${epsg - 32600}N), celle da ${res} m, ${rows} × ${cols}.

## Valori da inserire

| Parametro | Valore |
| --- | --- |
| Vento a 20 ft (6,1 m) | **${mph} mph @ 20'** (FlamMap accetta solo interi; vento medio a 10 m ${round(ws10, 2)} m/s, cioè ${round(ws20exact / 0.44704, 1)} mph a 20 ft) |
| Direzione di provenienza del vento | **${Math.round(from)}°** (gradi da Nord, da dove soffia) |
| Umidità | file \`umidita.fms\`: 1h ${pct(moist.m1)}%, 10h ${pct(moist.m10)}%, 100h ${pct(moist.m100)}%, erbacee ${pct(moist.herb)}%, legnose ${pct(moist.woody)}% |
| Condizionamento delle umidità | nessuno (umidità fisse del file .fms) |
| Innesco | \`innesco.shp\` (x ${ix.toFixed(1)}, y ${iy.toFixed(1)}) |
| Durata MTT | **${T} minuti** |
| Risoluzione MTT | **${res} m** |
| Probabilità di focolai secondari (spotting) | **0** |
| Fuoco di chioma | spento (CBD = 0 nel paesaggio) |

Vento e umidità sono le medie dei primi ${win} minuti dopo l'innesco (${start.toISOString()}), meteo Open-Meteo
${r.model}, punto ${zoneCfg.meteo_point_wgs84.lat}, ${zoneCfg.meteo_point_wgs84.lon}.

## Passi

1. **Paesaggio.** In FlamMap: *File → Create Landscape* (in alcune versioni *Landscape → Generate LCP*).
   Assegna i temi: Elevation = \`elevation.asc\` (metri), Slope = \`slope.asc\` (gradi), Aspect = \`aspect.asc\` (gradi),
   Fuel Model = \`fuel.asc\` (13 modelli di Anderson; 99 = non combustibile), Canopy Cover = \`cover.asc\` (percento),
   Stand Height = \`height.asc\` (metri), Canopy Base Height = \`cbh.asc\` (metri), Canopy Bulk Density = \`cbd.asc\` (kg/m³).
   Salva come \`paesaggio.lcp\` in questa cartella e aprilo (*File → Open Landscape*).
2. **Run.** *Analysis Area → New Run* (o tasto destro su *Runs*). Scheda *Model Inputs*: carica \`umidita.fms\`;
   vento: *Constant* con velocità e direzione della tabella; condizionamento: nessuno.
3. **MTT.** Scheda *Minimum Travel Time*: ignizione da file = \`innesco.shp\`; durata ${T} min; risoluzione ${res} m;
   spot probability 0; tutti i processori. Avvia (*Launch*).
4. **Uscita.** Al termine, nella lista delle uscite: tasto destro su *Arrival Time* → *Export* → griglia ASCII.
   Salvala come \`risultati/arrivo_flammap.asc\` in questa cartella. Fai lo stesso, se vuoi, per *Rate of Spread*.
5. **Facoltativo (vento sul terreno).** Ripeti il run con *Gridded Winds → WindNinja* (stessa velocità e direzione,
   risoluzione del vento 50 m) e salva l'arrivo come \`risultati/arrivo_flammap_windninja.asc\`.

Poi carica su GitHub (push) i file di \`risultati/\`. Il confronto si fa con:

\`\`\`
node validation/validate.js --case ${args.case}-flammap
node validation/temporal.js --case ${args.case} --arrivo data/zones/${kase.zone}/flammap/${args.case}/risultati/arrivo_flammap.asc --unita min --nome flammap --riferimento data/zones/${kase.zone}/validation/${args.case}-flammap/arrivo.npy
\`\`\`

Il primo simula con PropInc gli stessi ingressi semplificati (config/validation/${args.case}-flammap.json).
Il secondo misura FlamMap contro l'incendio reale (ad area uguale e passaggio per passaggio) e contro quella
simulazione di PropInc cella per cella: con ingressi identici la differenza misura l'implementazione, non i dati.
`);

console.log(`Ingressi di FlamMap in ${out}`);
console.log(`Vento 10 m ${ws10.toFixed(2)} m/s da ${from.toFixed(0)}° → FlamMap ${mph} mph a 20 ft (${ws10fm.toFixed(3)} m/s a 10 m) · umidità 1h ${pct(moist.m1)}% 10h ${pct(moist.m10)}% 100h ${pct(moist.m100)}% · innesco ${ix.toFixed(1)} ${iy.toFixed(1)}`);
console.log(`Caso PropInc equivalente: config/validation/${args.case}-flammap.json`);

// ---------------------------------------------------------------------------------------------------

function round(x, d) { return Math.round(x * 10 ** d) / 10 ** d; }

function utmPrj(zone) {
  return `PROJCS["WGS_1984_UTM_Zone_${zone}N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],`
    + `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],`
    + `PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${zone * 6 - 183}.0],PARAMETER["Scale_Factor",0.9996],`
    + `PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
}

/** Shapefile con un punto (specifica ESRI 1998): .shp, .shx e .dbf con un campo ID. */
function writePointShapefile(base, x, y) {
  const head = (lenWords) => {
    const b = Buffer.alloc(100);
    b.writeInt32BE(9994, 0); b.writeInt32BE(lenWords, 24); b.writeInt32LE(1000, 28); b.writeInt32LE(1, 32);
    b.writeDoubleLE(x, 36); b.writeDoubleLE(y, 44); b.writeDoubleLE(x, 52); b.writeDoubleLE(y, 60);
    return b;
  };
  const rec = Buffer.alloc(28);
  rec.writeInt32BE(1, 0); rec.writeInt32BE(10, 4); rec.writeInt32LE(1, 8); rec.writeDoubleLE(x, 12); rec.writeDoubleLE(y, 20);
  writeFileSync(`${base}.shp`, Buffer.concat([head(64), rec]));
  const idx = Buffer.alloc(8); idx.writeInt32BE(50, 0); idx.writeInt32BE(10, 4);
  writeFileSync(`${base}.shx`, Buffer.concat([head(54), idx]));
  const d = new Date(), h = Buffer.alloc(32 + 32 + 1);
  h.writeUInt8(3, 0); h.writeUInt8(d.getFullYear() - 1900, 1); h.writeUInt8(d.getMonth() + 1, 2); h.writeUInt8(d.getDate(), 3);
  h.writeInt32LE(1, 4); h.writeInt16LE(65, 8); h.writeInt16LE(1 + 5, 10);
  h.write('ID', 32, 'latin1'); h.write('N', 43, 'latin1'); h.writeUInt8(5, 48); h.writeUInt8(0, 49);
  h.writeUInt8(0x0d, 64);
  writeFileSync(`${base}.dbf`, Buffer.concat([h, Buffer.from(' ' + '    1', 'latin1'), Buffer.from([0x1a])]));
}
