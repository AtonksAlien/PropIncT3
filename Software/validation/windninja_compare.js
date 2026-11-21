// Confronto tra il vento di WindNinja e quello del nostro modello a conservazione della massa (D53, P37).
// Uso (da Software/):  node validation/windninja_compare.js siniscola [strato limite in m, default 1000]
// Per ogni corsa di WindNinja (data/zones/<zona>/windninja/out) confronta, sulle celle della zona:
//  - la direzione: differenza mediana e 90° percentile, e quanto ciascun modello ruota il vento in ingresso;
//  - la velocità: fattore medio, correlazione tra i fattori dei due modelli.
// Scrive data/zones/<zona>/windninja/confronto.json.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZone } from '../engine/load-node.js';
import { parseAsc, prepareRun, windNinjaSpeedUnit } from '../engine/windfield.js';
import { massWindFor } from '../engine/masswind.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zone = process.argv[2] ?? 'siniscola', blh = Number(process.argv[3] ?? 1000);
const zdir = join(ROOT, 'data', 'zones', zone), dir = join(zdir, 'windninja', 'out');
if (!existsSync(dir)) { console.error(`Nessuna uscita di WindNinja in ${dir}`); process.exit(1); }
const grid = loadZone(join(zdir, 'processed'));

const ad = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const q = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; };
const corr = (a, b) => {
  let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= b.length;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
};

const out = [];
const files = readdirSync(dir).filter((f) => /_vel\.asc$/.test(f)).sort();
for (const f of files) {
  const m = f.match(/_(\d+)_(\d+(?:\.\d+)?)_\d+m_vel\.asc$/);
  if (!m) continue;
  const angFile = f.replace(/_vel\.asc$/, '_ang.asc');
  if (!existsSync(join(dir, angFile))) continue;
  const run = prepareRun(grid, { fromDeg: Number(m[1]), speed: Number(m[2]), velUnit: wnUnit(m[1]), vel: parseAsc(readFileSync(join(dir, f), 'utf8')), ang: parseAsc(readFileSync(join(dir, angFile), 'utf8')) });
  const mw = massWindFor(grid, run.fromDeg, blh);
  const step = 5, dDir = [], rotWN = [], rotMW = [], fWN = [], fMW = [];
  for (let r = 0; r < grid.rows; r += step) for (let c = 0; c < grid.cols; c += step) {
    const i = r * grid.cols + c;
    dDir.push(ad(run.from[i], mw.from(i))); rotWN.push(ad(run.from[i], run.fromDeg)); rotMW.push(ad(mw.from(i), run.fromDeg));
    fWN.push(run.factor[i]); fMW.push(mw.factor(i));
  }
  const row = {
    direzione: run.fromDeg,
    differenza_direzione_mediana: q(dDir, 0.5), differenza_direzione_p90: q(dDir, 0.9),
    rotazione_mediana_windninja: q(rotWN, 0.5), rotazione_p90_windninja: q(rotWN, 0.9),
    rotazione_mediana_nostro: q(rotMW, 0.5), rotazione_p90_nostro: q(rotMW, 0.9),
    fattore_medio_windninja: fWN.reduce((a, b) => a + b, 0) / fWN.length, fattore_medio_nostro: fMW.reduce((a, b) => a + b, 0) / fMW.length,
    correlazione_velocita: corr(fWN, fMW),
  };
  out.push(row);
  console.log(`${run.fromDeg}°: differenza di direzione mediana ${row.differenza_direzione_mediana.toFixed(1)}° (p90 ${row.differenza_direzione_p90.toFixed(1)}°) · `
    + `rotazione mediana WindNinja ${row.rotazione_mediana_windninja.toFixed(1)}°, nostro ${row.rotazione_mediana_nostro.toFixed(1)}° · `
    + `correlazione delle velocità ${row.correlazione_velocita.toFixed(2)}`);
}
writeFileSync(join(zdir, 'windninja', 'confronto.json'), JSON.stringify({ zona: zone, strato_limite_m: blh, corse: out }, null, 2));
console.log(`Scritto ${join(zdir, 'windninja', 'confronto.json')}`);

/** Unità delle velocità di una corsa, dalla sua configurazione wn_<dir>.cfg (WindNinja: mph se non indicato). */
function wnUnit(dir) {
  const f = join(zdir, 'windninja', `wn_${String(dir).padStart(3, '0')}.cfg`);
  return existsSync(f) ? windNinjaSpeedUnit(readFileSync(f, 'utf8')) : 'mph';
}
