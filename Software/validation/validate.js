#!/usr/bin/env node
// Validazione su un incendio reale: confronto tra area bruciata osservata e simulata.
//
//   cd Software && node validation/validate.js --case dualchi-2019
//   node validation/validate.js --case esempio-mercadante          (esempio sintetico incluso)
//
// Il caso è descritto in config/validation/<caso>.json (formato in config/validation/README.md).
// Uscita in data/zones/<zona>/validation/<caso>/:
//   rapporto.md     tabella dei risultati da leggere (e da copiare nella tesi)
//   metriche.json   tutti i numeri
//   confronto.png                      mappa: verde = in comune, blu = mancata, arancio = falso allarme
//   punti_caldi.csv confronto tra i passaggi del satellite e il tempo di arrivo simulato (se ci sono)
//
// Opzioni: --tol 60 (tolleranza in minuti sui punti caldi) · --barriers on|off|assolute · --live-ndvi on|off
//          --combustibile-ndvi on|off (dettaglio a 10 m del combustibile dall'NDVI, D54)
//          --vento-terreno on|off|<η in m> (MicroMet, D52) | massa:<strato limite in m> (conservazione della massa, D53) · --out <nome> (cartella dei risultati)
//          --ensemble N (insieme di N simulazioni con innesco, ora e vento perturbati; scrive probabilita.png)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { isIgnitable, withBarriers } from '../engine/grid.js';
import { withNdviFuel } from '../engine/fuelndvi.js';
import { parseAsc, prepareRun, windNinjaSpeedUnit } from '../engine/windfield.js';
import { readdirSync } from 'node:fs';
import { parseFuelModels } from '../engine/fuels.js';
import { makeWeather } from '../engine/simulate.js';
import { encodePNG } from '../engine/png.js';
import { fetchForSimulation, fetchBoundaryLayer } from '../backend/src/weather/openmeteo.js';
import { rasterizePerimeter } from './lib/perimeter.js';
import { parseFirms, firstDetection, cellOf } from './lib/hotspots.js';
import { evaluate } from './lib/evaluate.js';
import { runEnsemble } from './lib/ensemble.js';
import { groupPasses, temporalAnalysis, summarizeMembers } from './lib/temporal.js';
import { writeTemporal } from './lib/temporal-report.js';
import { writeNpy } from '../engine/npy.js';
import { renderReport } from './lib/report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { case: null, tol: 60, barriers: null, 'live-ndvi': null, 'vento-terreno': null, 'combustibile-ndvi': null, out: null, ensemble: 0 };
const argv = process.argv.slice(2);
// Accetta anche il nome del caso senza "--case": su PowerShell "npm run validate -- --case x" perde "--case"
if (argv.length && !argv[0].startsWith('--')) args.case = argv.shift();
for (let k = 0; k < argv.length; k += 2) args[argv[k].replace(/^--/, '')] = argv[k + 1];
if (!args.case) fail('Uso: node validation/validate.js --case <nome>  oppure  node validation/validate.js <nome>   (file in config/validation/<nome>.json)');

const casePath = join(ROOT, 'config', 'validation', `${args.case}.json`);
if (!existsSync(casePath)) fail(`Caso non trovato: ${casePath}`);
const kase = JSON.parse(readFileSync(casePath, 'utf8'));
const zdir = join(ROOT, 'data', 'zones', kase.zone);
const zoneCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'zones', `${kase.zone}.json`), 'utf8'));
if (!existsSync(join(zdir, 'processed', 'manifest.json'))) fail(`La zona ${kase.zone} non ha ancora il pacchetto: python pipeline/prepare_zone.py --zone ${kase.zone}`);
const grid = loadZone(join(zdir, 'processed'));
const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline', 'tables', 'fuel_models.csv'), 'utf8'));
console.log(`Caso ${args.case}: ${kase.name}\nZona ${grid.manifest.name}: ${grid.rows}×${grid.cols} celle da ${grid.res} m (${grid.manifest.crs})`);

// --- area osservata --------------------------------------------------------------------------------
const perimPath = join(zdir, kase.perimeter);
if (!existsSync(perimPath)) fail(`Perimetro non trovato: ${perimPath}`);
const perim = rasterizePerimeter(grid, JSON.parse(readFileSync(perimPath, 'utf8')), { filter: kase.perimeter_filter ?? null });
if (!perim.cells) fail('Il perimetro non copre nessuna cella della zona: controlla coordinate, sistema di riferimento e filtro');
console.log(`Perimetro osservato: ${perim.features} elementi, ${perim.cells} celle (${(perim.cells * grid.res ** 2 / 1e4).toFixed(1)} ha)`);
const warnings = [];
if (perim.cut) warnings.push('Il perimetro osservato esce dalla griglia della zona: allarga aoi_utm nella configurazione della zona, altrimenti una parte dell\'incendio non viene confrontata.');

// --- punti caldi (facoltativi) ---------------------------------------------------------------------
let hotspots = null;
if (kase.hotspots) {
  const hp = join(zdir, kase.hotspots);
  if (!existsSync(hp)) fail(`File dei punti caldi non trovato: ${hp}`);
  hotspots = parseFirms(readFileSync(hp, 'utf8'));
  const first = firstDetection(grid, hotspots);
  console.log(`Punti caldi FIRMS: ${hotspots.length}` + (first ? `, primo passaggio nella zona ${first.time} (${first.count} punti, centro ${first.lat.toFixed(4)}, ${first.lon.toFixed(4)})` : ', nessuno nella zona'));
}

// --- innesco e ora ---------------------------------------------------------------------------------
let ignitions, ignitionNote = 'dalla configurazione del caso';
if (kase.ignitions_wgs84?.length) {
  ignitions = kase.ignitions_wgs84.map(([lat, lon]) => cellOf(grid, lat, lon) ?? fail(`Innesco ${lat}, ${lon} fuori dalla zona`));
} else {
  const first = hotspots && firstDetection(grid, hotspots);
  if (!first) fail('Serve "ignitions_wgs84" nel caso, oppure un file di punti caldi da cui stimarlo');
  ignitions = [cellOf(grid, first.lat, first.lon)];
  ignitionNote = `stimato dal primo passaggio FIRMS (${first.time}): incerto di qualche centinaio di metri`;
  warnings.push(`Innesco ${ignitionNote}.`);
}
if (!kase.start) fail('Serve "start" (ora dell\'innesco, ISO 8601 con fuso, es. 2019-08-06T13:00+02:00)');
const start = new Date(kase.start);
const hours = Number(kase.hours ?? 24), maxMin = hours * 60;
const tEndMin = kase.observed_end ? (new Date(kase.observed_end) - start) / 60000 : maxMin;
if (tEndMin > maxMin) fail('observed_end è oltre la durata simulata: aumenta "hours"');
const barriers = args.barriers ? (args.barriers === 'off' ? false : args.barriers === 'assolute' ? 'assolute' : true)
  : kase.barriers === false ? false : kase.barriers === 'assolute' ? 'assolute' : true;
const liveNdvi = args['live-ndvi'] ? args['live-ndvi'] !== 'off' : kase.live_ndvi !== false;
// vento corretto dal rilievo (D52): on = η di default, un numero = η in metri, off = vento uniforme
// combustibile corretto dall'NDVI di prima dell'evento (D54): on|off
const fuelNdvi = args['combustibile-ndvi'] ? args['combustibile-ndvi'] === 'on' : kase.fuel_ndvi === true;
// default (D53): vento a conservazione della massa con lo strato limite orario di ERA5
const twArg = args['vento-terreno'] ?? (kase.terrain_wind === undefined ? 'massa' : String(kase.terrain_wind));
// massa:<altezza strato limite in m> = vento a conservazione della massa (D53)
// windninja = griglie di WindNinja in data/zones/<zona>/windninja/out (P37)
const terrainWind = twArg === null || twArg === 'off' || twArg === 'false' ? false
  : twArg === 'windninja' ? { method: 'campo', source: 'windninja', runs: loadWindNinja() }
  // "massa" senza numero = altezza dello strato limite oraria da ERA5
  : twArg.startsWith('massa') ? { method: 'massa', blhM: twArg.includes(':') ? Number(twArg.split(':')[1]) : 'era5' }
    : Number.isFinite(Number(twArg)) && twArg !== 'true' ? { etaM: Number(twArg) } : true;
// gli inneschi vanno su celle che bruciano davvero nella simulazione: con le barriere, non su una strada
const ignGrid = barriers === false ? grid : withBarriers(grid, { absolute: barriers === 'assolute' });
ignitions = ignitions.map((p) => snapToFuel(p));

// --- meteo -----------------------------------------------------------------------------------------
let weather, meteoNote, hourlyJson = null;
if (kase.wind) {
  weather = makeWeather({ wind: kase.wind, durMin: maxMin, moist: kase.moisture ?? null });
  meteoNote = `vento costante ${kase.wind.speed} m/s da ${kase.wind.from}° (umidità ${kase.moisture ? 'dal caso' : 'di default'})`;
} else {
  const r = await fetchForSimulation(zoneCfg.meteo_point_wgs84, start, maxMin, { cacheDir: join(zdir, 'raw', 'meteo') });
  hourlyJson = r.json;
  let blhJson = null;
  if (terrainWind?.blhM === 'era5') {
    blhJson = (await fetchBoundaryLayer(zoneCfg.meteo_point_wgs84, start, maxMin, { cacheDir: join(zdir, 'raw', 'meteo') })).json;
  }
  weather = makeWeather({ hourlyJson: r.json, start, durMin: maxMin, blhJson });
  meteoNote = `Open-Meteo ${r.source}, modello ${r.model}${r.fromCache ? ' (cache)' : ''}, punto ${zoneCfg.meteo_point_wgs84.lat}, ${zoneCfg.meteo_point_wgs84.lon}`;
}
console.log(`Innesco ${ignitions.map(({ r, c }) => `r${r} c${c}`).join(', ')} · ${start.toISOString()} · ${hours} h simulate · meteo: ${meteoNote}`);

// --- valutazione -----------------------------------------------------------------------------------
const t0 = Date.now();
const res = evaluate({ grid, models, weather, ignitions, obsMask: perim.mask, maxMin, tEndMin, barriers, liveNdvi, terrainWind, fuelNdvi,
  hotspots, startMs: start.getTime(), tolMin: Number(args.tol), onProgress: (m) => console.log(`  … ${m}`) });
console.log(`Calcolo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- confronto nel tempo, passaggio per passaggio del satellite (se ci sono punti caldi) ------------
const domain = res.masks.domain;
const passes = hotspots ? groupPasses(grid, hotspots, start.getTime(), cellOf) : null;
const temporal = passes ? temporalAnalysis({ grid, arrival: res.arrival, passes, obsMask: perim.mask, domain, maxMin, tolMin: Number(args.tol) }) : null;
const memberTemporal = [];

// --- insieme di simulazioni (facoltativo) -----------------------------------------------------------
let ens = null;
if (Number(args.ensemble) > 0) {
  const t1 = Date.now(), win = kase.start_window_min ?? [0, 0];
  if (win[1] > 0 && hourlyJson) {   // il meteo in cache deve coprire anche l'innesco più tardo
    const r2 = await fetchForSimulation(zoneCfg.meteo_point_wgs84, new Date(start.getTime() + win[1] * 60000), maxMin, { cacheDir: join(zdir, 'raw', 'meteo') });
    hourlyJson = r2.json;
  }
  ens = runEnsemble({
    grid, models, obsMask: perim.mask, maxMin, barriers, liveNdvi, terrainWind, fuelNdvi, ignition: ignitions[0], snap: snapQuiet,
    members: Number(args.ensemble), radiusM: kase.ignition_radius_m ?? 375, windowMin: win,
    windPct: kase.ensemble_wind_pct ?? 0.25, windDeg: kase.ensemble_wind_deg ?? 20,
    makeWx: (off) => (kase.wind ? makeWeather({ wind: kase.wind, durMin: maxMin, moist: kase.moisture ?? null })
      : makeWeather({ hourlyJson, start: new Date(start.getTime() + off * 60000), durMin: maxMin })),
    onMember: passes ? (arrival, run) => memberTemporal.push(temporalAnalysis({ grid, arrival, passes, obsMask: perim.mask, domain, maxMin, tolMin: Number(args.tol), offsetMin: run.offsetMin })) : null,
    onProgress: (m) => console.log(`  … ${m}`),
  });
  console.log(`Insieme di ${ens.members} simulazioni: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}
if (res.C.areaMatched.tMin === null) warnings.push(`Il modello C non raggiunge l'area osservata in ${hours} h: il confronto "ad area uguale" usa tutta l'area simulata (aumenta "hours" o controlla meteo e innesco).`);

// --- uscita ----------------------------------------------------------------------------------------
const out = join(zdir, 'validation', args.out ?? args.case);
mkdirSync(out, { recursive: true });
const info = { case: args.case, kase, zone: grid.manifest.name, crs: grid.manifest.crs, res: grid.res, start: start.toISOString(),
  hours, tEndMin, ignitions, ignitionNote, meteo: meteoNote, barriers, liveNdvi,
  terrainWind: terrainWind?.runs ? { method: terrainWind.method, source: terrainWind.source, runsFrom: terrainWind.runs.map((r) => r.fromDeg) } : terrainWind,
  fuelNdvi, fuelNdviInfo: fuelNdvi ? withNdviFuel(grid).fuelNdvi ?? null : null, warnings, created: new Date().toISOString() };
const { masks, arrival, ...numbers } = res;
if (ens) { const { prob, ...rest } = ens; numbers.ensemble = rest; }
writeFileSync(join(out, 'metriche.json'), JSON.stringify({ ...info, ...numbers }, (k, v) => (v === Infinity ? null : v), 2));
writeFileSync(join(out, 'rapporto.md'), renderReport(info, numbers));
if (ens) writeFileSync(join(out, 'probabilita.png'), encodePNG(probabilityImage(ens.prob, masks.observed), grid.cols, grid.rows));
writeFileSync(join(out, 'confronto.png'), encodePNG(comparisonImage(masks.observed, masks.C), grid.cols, grid.rows));
if (res.C.hotspots) {
  const rows = ['ora_utc,lat,lon,strumento,min_dall_innesco,arrivo_simulato_min,errore_min,esito'];
  for (const p of res.C.hotspots.points) rows.push([p.time, p.lat, p.lon, p.instrument, fmt(p.tObsMin), fmt(p.simFirstMin), fmt(p.errMin), p.status].join(','));
  writeFileSync(join(out, 'punti_caldi.csv'), rows.join('\n') + '\n');
}
// mappa dei tempi di arrivo (minuti dall'innesco, inf = mai): per validation/temporal.js e per confronti esterni
writeFileSync(join(out, 'arrivo.npy'), writeNpy(Float32Array.from(res.arrival), [grid.rows, grid.cols]));
if (temporal) writeTemporal(out, { source: 'PropInc (simulazione singola)', case: args.case, start: start.toISOString(), passes: temporal,
  ensemble: memberTemporal.length ? summarizeMembers(memberTemporal) : null, members: memberTemporal.length });
console.log('\n' + summaryLine(res));
for (const w of warnings) console.log(`ATTENZIONE: ${w}`);
console.log(`\nRisultati in ${out}`);

// ---------------------------------------------------------------------------------------------------

function fail(msg) { console.error(msg); process.exit(1); }
function fmt(v) { return v === null || v === undefined ? '' : Math.round(v); }

/**
 * Cella combustibile più vicina a p entro 100 m (p compresa), preferendo quelle dentro l'area bruciata
 * osservata: l'incendio è partito dentro il suo perimetro, e un innesco spostato oltre una barriera
 * (per esempio dall'altra parte di una superstrada) cambierebbe tutta la simulazione.
 */
function nearestIgnitable(p) {
  let best = null;
  for (let d = 0; d <= 10; d++) {
    for (let r = p.r - d; r <= p.r + d; r++) for (let c = p.c - d; c <= p.c + d; c++) {
      if (Math.max(Math.abs(r - p.r), Math.abs(c - p.c)) !== d || !isIgnitable(ignGrid, { r, c })) continue;
      const inside = perim.mask[r * grid.cols + c] === 1;
      if (inside) return { r, c, d };
      best ??= { r, c, d };
    }
  }
  return best;
}

/** Innesco su una cella non combustibile (strada, roccia): si sposta con nearestIgnitable e lo si segnala. */
function snapToFuel(p) {
  const q = nearestIgnitable(p);
  if (!q) return fail(`Innesco r${p.r} c${p.c}: nessuna cella combustibile entro 100 m`);
  if (q.r !== p.r || q.c !== p.c) warnings.push(`Innesco r${p.r} c${p.c} non combustibile o fuori dall'area osservata: spostato su r${q.r} c${q.c} (${q.d * grid.res} m).`);
  return { r: q.r, c: q.c };
}

/** Come snapToFuel, senza avvisi (per le simulazioni dell'insieme). */
function snapQuiet(p) {
  const q = nearestIgnitable(p);
  return q ? { r: q.r, c: q.c } : ignitions[0];
}

/** Probabilità di bruciare (giallo → rosso scuro, sequenziale) con il contorno dell'area osservata in nero. */
function probabilityImage(prob, obs) {
  const rgb = new Uint8Array(grid.n * 3);
  const ramp = [[255, 245, 200], [254, 196, 79], [236, 112, 20], [189, 0, 38], [103, 0, 13]];
  for (let i = 0; i < grid.n; i++) {
    let col = grid.fuel[i] > 0 ? [235, 235, 228] : [190, 190, 190];
    if (prob[i] > 0) {
      const x = prob[i] * (ramp.length - 1), k = Math.min(ramp.length - 2, Math.floor(x)), f = x - k;
      col = ramp[k].map((v, j) => Math.round(v + f * (ramp[k + 1][j] - v)));
    }
    rgb.set(col, i * 3);
  }
  for (let r = 1; r < grid.rows - 1; r++) for (let c = 1; c < grid.cols - 1; c++) {
    const i = r * grid.cols + c;
    if (obs[i] && (!obs[i - 1] || !obs[i + 1] || !obs[i - grid.cols] || !obs[i + grid.cols])) rgb.set([0, 0, 0], i * 3);
  }
  return rgb;
}

/** Immagine del confronto: verde in comune, blu solo osservata, arancio solo simulata (Okabe-Ito). */
function comparisonImage(obs, sim) {
  const rgb = new Uint8Array(grid.n * 3);
  for (let i = 0; i < grid.n; i++) {
    const col = obs[i] && sim[i] ? [0, 158, 115] : obs[i] ? [0, 114, 178] : sim[i] ? [230, 159, 0]
      : grid.fuel[i] > 0 ? [235, 235, 228] : [190, 190, 190];
    rgb.set(col, i * 3);
  }
  for (const { r, c } of ignitions) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < grid.rows && cc < grid.cols) rgb.set([0, 0, 0], (rr * grid.cols + cc) * 3);
    }
  }
  return rgb;
}

function summaryLine(r) {
  const p = (x) => (x === null ? '—' : `${(x * 100).toFixed(0)}%`);
  return [
    `Area osservata ${r.observed.haBurnable.toFixed(1)} ha combustibili (${r.observed.ha.toFixed(1)} ha in tutto)`,
    `Sørensen ad area uguale: modello ${p(r.C.areaMatched.sorensen)} · ellisse ${p(r.baselines.ellipse.sorensen)} · cerchio ${p(r.baselines.circle.sorensen)}`,
    `Miglioramento sull'ellisse: ${p(r.skills.C)}`,
    r.C.hotspots ? `Punti caldi coerenti con il modello: ${p(r.C.hotspots.summary.consistent)} su ${r.C.hotspots.summary.used} (in ritardo ${p(r.C.hotspots.summary.late)})` : 'Punti caldi: nessun file',
  ].join('\n');
}

/** Corse di WindNinja: coppie <...>_<direzione>_<velocità>_<risoluzione>m_vel.asc / _ang.asc. */
function loadWindNinja() {
  const dir = join(zdir, 'windninja', 'out');
  if (!existsSync(dir)) fail(`Nessuna uscita di WindNinja in ${dir}: eseguire data/zones/${kase.zone}/windninja/esegui_windninja.ps1`);
  const runs = [];
  for (const f of readdirSync(dir)) {
    const m = f.match(/_(\d+)_(\d+(?:\.\d+)?)_\d+m_vel\.asc$/);
    if (!m) continue;
    const angFile = f.replace(/_vel\.asc$/, '_ang.asc');
    if (!existsSync(join(dir, angFile))) continue;
    runs.push(prepareRun(grid, { fromDeg: Number(m[1]), speed: Number(m[2]), velUnit: wnUnit(m[1]),
      vel: parseAsc(readFileSync(join(dir, f), 'utf8')), ang: parseAsc(readFileSync(join(dir, angFile), 'utf8')) }));
  }
  if (!runs.length) fail(`Nessuna coppia *_vel.asc / *_ang.asc in ${dir}`);
  console.log(`WindNinja: ${runs.length} corse (${runs.map((r) => r.fromDeg).sort((a, b) => a - b).join(', ')} gradi)`);
  return runs;
}

/** Unità delle velocità di una corsa, dalla sua configurazione wn_<dir>.cfg (WindNinja: mph se non indicato). */
function wnUnit(dir) {
  const f = join(zdir, 'windninja', `wn_${String(dir).padStart(3, '0')}.cfg`);
  return existsSync(f) ? windNinjaSpeedUnit(readFileSync(f, 'utf8')) : 'mph';
}
