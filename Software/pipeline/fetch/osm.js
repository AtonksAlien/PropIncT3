#!/usr/bin/env node
// Scarica da OpenStreetMap (API Overpass) strade, ferrovie e acque della zona, con un margine di 500 m.
//
//   cd Software && node pipeline/fetch/osm.js --zone mercadante        (--force per riscaricare)
//
// Uscita: data/zones/<zona>/raw/osm/overpass.json (cache: se esiste non si riscarica).
// Perché Overpass e non l'estratto Geofabrik: servono solo gli oggetti di un riquadro di circa 7 km;
// l'estratto dell'Italia del Sud pesa 377 MB. Dati © OpenStreetMap contributors, licenza ODbL.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, k, all) => (a.startsWith('--') ? [a.slice(2), all[k + 1]?.startsWith('--') || all[k + 1] === undefined ? true : all[k + 1]] : null)).filter(Boolean));
const zone = args.zone ?? 'mercadante';
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'zones', `${zone}.json`), 'utf8'));
const out = join(ROOT, 'data', 'zones', zone, 'raw', 'osm', 'overpass.json');

if (existsSync(out) && !args.force) {
  console.log(`Già presente: ${out} (usa --force per riscaricare)`);
  process.exit(0);
}

const m = 0.006;   // circa 500 m di margine in latitudine e longitudine
const a = cfg.aoi_wgs84;
const bbox = [a.lat_min - m, a.lon_min - m, a.lat_max + m, a.lon_max + m].map((v) => v.toFixed(5)).join(',');
const query = `[out:json][timeout:90];
(
  way["highway"](${bbox});
  way["railway"](${bbox});
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["landuse"="reservoir"](${bbox});
);
out geom;`;

console.log(`Overpass: riquadro ${bbox}`);
// Il server pubblico risponde 429/504 quando è pieno: si riprova con attesa crescente (5, 10, 20, 40 s),
// alternando il server principale e un mirror pubblico.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let json = null, lastErr = '';
for (let attempt = 0; attempt < 5 && !json; attempt++) {
  const url = ENDPOINTS[attempt % ENDPOINTS.length];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PropInc (tesi di laurea, simulatore di incendi)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (res.ok) { json = await res.json(); break; }
    lastErr = `HTTP ${res.status} da ${new URL(url).host}`;
  } catch (e) { lastErr = `${e.message} (${new URL(url).host})`; }
  if (attempt < 4) {
    const wait = 5 * 2 ** attempt;
    console.log(`  Overpass non disponibile (${lastErr}): nuovo tentativo tra ${wait} s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}
if (!json) throw new Error(`Overpass: nessuna risposta dopo 5 tentativi (ultimo: ${lastErr}). Riprova più tardi.`);
json.propinc = { zone, bbox, query, scaricato: new Date().toISOString(), licenza: '© OpenStreetMap contributors, ODbL' };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(json));
const count = {};
for (const e of json.elements) {
  const k = e.tags?.highway ? `highway=${e.tags.highway}` : e.tags?.railway ? `railway=${e.tags.railway}` : e.tags?.waterway ? `waterway=${e.tags.waterway}` : 'acqua (superficie)';
  count[k] = (count[k] ?? 0) + 1;
}
console.log(`${json.elements.length} oggetti → ${out}`);
for (const [k, v] of Object.entries(count).sort((x, y) => y[1] - x[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
