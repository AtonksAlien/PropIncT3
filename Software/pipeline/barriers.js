#!/usr/bin/env node
// Barriere da OpenStreetMap: aggiunge al pacchetto zona il layer `barriers` (uint8, stessa griglia).
//
//   cd Software && node pipeline/fetch/osm.js --zone mercadante     (una volta: scarica i dati)
//                  node pipeline/barriers.js --zone mercadante       (dopo prepare_zone.py)
//
// Scritto in JavaScript, non in Python come il resto della pipeline: riusa la proiezione UTM e il formato
// .npy già verificati nel motore (engine/geo.js, engine/npy.js) e non richiede librerie GIS (DECISIONI D32).
//
// Codici del layer (le prime tre classi fermano il fuoco, se le barriere sono attive):
//   0 nessuna · 1 strada asfaltata · 3 ferrovia · 4 acqua · 2 pista o sentiero (solo visualizzazione)
// Perché le piste non fermano il fuoco: 3–4 m di terra in una cella di 10 m; il fuoco le supera dall'erba
// ai bordi. Una strada asfaltata di 6–8 m con le banchine rende invece la cella quasi non combustibile.
//
// Secondo layer `barrier_width` (uint8, metri): larghezza della fascia senza combustibile in ogni cella
// di barriera; 255 = invalicabile. Il motore lo usa per decidere se il fronte salta la barriera
// (regola della lunghezza di fiamma, engine/mtt.js, DECISIONI D46). Larghezza dal tag OSM `width`,
// se presente; altrimenti un valore tipico per classe (assunzione dichiarata, WIDTH_BY_CLASS). Invalicabili solo
// laghi e invasi: anche una superstrada è una fascia finita, che una fiamma abbastanza lunga supera (D49).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToUtm, utmZoneOf } from '../engine/geo.js';
import { writeNpy } from '../engine/npy.js';
import { rasterizeLine, rasterizePolygon } from './raster.js';

export const BARRIER = { NONE: 0, ROAD: 1, TRACK: 2, RAIL: 3, WATER: 4 };
export const BLOCKING = [BARRIER.ROAD, BARRIER.RAIL, BARRIER.WATER];
const PRIORITY = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4 };   // in caso di sovrapposizione vince la classe più "forte"

const PAVED_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);
const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'mud', 'sand', 'compacted', 'pebblestone']);
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'concrete:plates']);

/** Larghezza tipica della fascia senza combustibile (carreggiata + banchine), in metri. 255 = invalicabile. */
export const WIDTH_BY_CLASS = {
  motorway: 30, trunk: 25, motorway_link: 12, trunk_link: 12,      // carreggiate separate con spartitraffico e banchine (D49)
  primary: 12, primary_link: 12, secondary: 9, secondary_link: 9, tertiary: 7, tertiary_link: 7,
  unclassified: 5, residential: 5, living_street: 5,
  track: 4, service: 4,                                             // solo se asfaltate (altrimenti non sono barriere)
  rail: 8, light_rail: 8, narrow_gauge: 6,                         // massicciata e fascia ripulita
  river: 15, canal: 8, water: 255,                                  // laghi e invasi: invalicabili
};
export const IMPASSABLE = 255;

/** Larghezza (m) della barriera di un oggetto OSM già classificato come bloccante. */
export function widthOf(tags = {}) {
  const w = parseFloat(String(tags.width ?? '').replace(',', '.'));
  const key = tags.natural === 'water' || tags.landuse === 'reservoir' ? 'water'
    : tags.waterway ?? tags.railway ?? tags.highway;
  const base = WIDTH_BY_CLASS[key] ?? 6;
  if (base === IMPASSABLE) return IMPASSABLE;
  return Number.isFinite(w) && w > 0 ? Math.min(Math.round(w), 254) : base;
}

/** Classe di un oggetto OSM, oppure null se non interessa. Il fondo (`surface`), se indicato, prevale. */
export function classify(tags = {}) {
  if (tags.natural === 'water' || tags.landuse === 'reservoir') return { code: BARRIER.WATER, area: true };
  if (tags.waterway && ['river', 'canal'].includes(tags.waterway)) return { code: BARRIER.WATER, area: false };
  if (tags.railway && ['rail', 'light_rail', 'narrow_gauge'].includes(tags.railway)) return { code: BARRIER.RAIL, area: false };
  if (tags.highway) {
    if (tags.area === 'yes') return null;
    const s = tags.surface;
    if (PAVED_ROADS.has(tags.highway)) return { code: s && UNPAVED.has(s) ? BARRIER.TRACK : BARRIER.ROAD, area: false };
    if (['track', 'service', 'path', 'footway', 'cycleway', 'bridleway'].includes(tags.highway)) {
      return { code: s && PAVED.has(s) && ['track', 'service'].includes(tags.highway) ? BARRIER.ROAD : BARRIER.TRACK, area: false };
    }
  }
  return null;
}

/** Rasterizza gli oggetti OSM sulla griglia del manifest. @returns { layer: Uint8Array, width: Uint8Array, stats } */
export function buildBarriers(manifest, osm) {
  const { rows, cols, resolution_m: res, origin_utm: o } = manifest, zone = utmZoneOf(manifest.crs);
  const layer = new Uint8Array(rows * cols);
  const width = new Uint8Array(rows * cols);   // la barriera più larga che tocca la cella
  const stats = { objects: {}, cells: { 1: 0, 2: 0, 3: 0, 4: 0 } };
  const set = (r, c, code, w) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    const i = r * cols + c;
    if (PRIORITY[code] > PRIORITY[layer[i]]) layer[i] = code;
    if (BLOCKING.includes(code) && w > width[i]) width[i] = w;
  };
  for (const e of osm.elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const k = classify(e.tags);
    if (!k) continue;
    const w = BLOCKING.includes(k.code) ? widthOf(e.tags) : 0;
    stats.objects[k.code] = (stats.objects[k.code] ?? 0) + 1;
    const pts = e.geometry.map(({ lat, lon }) => { const p = latLonToUtm(lat, lon, zone); return [(p.x - o.x) / res, (o.y - p.y) / res]; });
    const closed = pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
    if (k.area && closed) rasterizePolygon(pts, rows, cols, (r, c) => set(r, c, k.code, w));
    else rasterizeLine(pts, (r, c) => set(r, c, k.code, w));
  }
  for (const v of layer) if (v) stats.cells[v]++;
  stats.impassableCells = 0;
  for (const v of width) if (v === IMPASSABLE) stats.impassableCells++;
  return { layer, width, stats };
}

// --- esecuzione da riga di comando
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const zi = process.argv.indexOf('--zone'), zone = zi > 0 ? process.argv[zi + 1] : 'mercadante';
  const dir = join(ROOT, 'data', 'zones', zone, 'processed');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const osm = JSON.parse(readFileSync(join(ROOT, 'data', 'zones', zone, 'raw', 'osm', 'overpass.json'), 'utf8'));
  const { layer, width, stats } = buildBarriers(manifest, osm);
  writeFileSync(join(dir, 'barriers.npy'), writeNpy(layer, [manifest.rows, manifest.cols]));
  writeFileSync(join(dir, 'barrier_width.npy'), writeNpy(width, [manifest.rows, manifest.cols]));
  // celle combustibili coperte da una barriera: quelle che i modelli tratteranno come non combustibili
  const fuel = readFileSync(join(dir, manifest.layers.fuel.file));
  const off = fuel.readUInt16LE(8) + 10;
  let blockedFuel = 0;
  for (let i = 0; i < layer.length; i++) if (BLOCKING.includes(layer[i]) && fuel[off + i] > 0) blockedFuel++;
  manifest.layers.barriers = { file: 'barriers.npy', dtype: 'uint8' };
  manifest.layers.barrier_width = { file: 'barrier_width.npy', dtype: 'uint8' };
  manifest.units.barrier_width = 'metri di fascia senza combustibile nelle celle di barriera; 255 = invalicabile';
  manifest.units.barriers = '0 nessuna, 1 strada asfaltata, 2 pista o sentiero (non ferma il fuoco), 3 ferrovia, 4 acqua';
  manifest.sources.barriers = `OpenStreetMap (Overpass, ${osm.propinc?.scaricato?.slice(0, 10) ?? 'data sconosciuta'}), © OpenStreetMap contributors, ODbL`;
  manifest.barriers = { cells: stats.cells, objects: stats.objects, blockedFuelCells: blockedFuel, blocking: BLOCKING };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const ha = (n) => ((n * manifest.resolution_m ** 2) / 1e4).toFixed(1);
  console.log(`Barriere ${zone}: strade asfaltate ${stats.cells[1]} celle (${stats.objects[1] ?? 0} tratti) · piste e sentieri ${stats.cells[2]} (${stats.objects[2] ?? 0}) · ferrovie ${stats.cells[3]} · acqua ${stats.cells[4]} (${stats.objects[4] ?? 0} oggetti)`);
  console.log(`Celle invalicabili (laghi e invasi): ${stats.impassableCells}`);
  console.log(`Celle combustibili che diventano barriera: ${blockedFuel} (${ha(blockedFuel)} ha, ${(100 * blockedFuel / layer.length).toFixed(1)}% della zona)`);
}
