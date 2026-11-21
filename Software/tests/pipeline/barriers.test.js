// Test delle barriere OSM: rasterizzazione, classificazione, scrittura .npy, effetto nei modelli.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traverseSegment, rasterizeLine, rasterizePolygon } from '../../pipeline/raster.js';
import { classify, buildBarriers, BARRIER, widthOf } from '../../pipeline/barriers.js';
import { writeNpy, parseNpy } from '../../engine/npy.js';
import { uniformGrid, withBarriers } from '../../engine/grid.js';
import { utmToLatLon } from '../../engine/geo.js';
import { parseFuelModels } from '../../engine/fuels.js';
import { makeWeather, simulate } from '../../engine/simulate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cells = (fn) => { const s = new Set(); fn((r, c) => s.add(`${r},${c}`)); return s; };

test('raster: segmento orizzontale e diagonale, tutte le celle toccate', () => {
  assert.deepEqual([...cells((v) => traverseSegment(0.5, 0.5, 3.5, 0.5, v))].sort(), ['0,0', '0,1', '0,2', '0,3']);
  // diagonale da (0,2; 0,1) a (2,9; 1,4): la retta passa la riga y = 1 a x = 0,2 + 0,9 · 2,7/1,3 = 2,07,
  // quindi attraversa le celle (0,0), (0,1), (0,2) e poi (1,2)
  const d = cells((v) => traverseSegment(0.2, 0.1, 2.9, 1.4, v));
  assert.deepEqual([...d].sort(), ['0,0', '0,1', '0,2', '1,2']);
  // passaggio esatto per un vertice: tocca anche le due celle laterali (nessun "buco" diagonale)
  const v = cells((f) => traverseSegment(0.5, 0.5, 1.5, 1.5, f));
  assert.ok(v.has('0,0') && v.has('1,1') && v.has('0,1') && v.has('1,0'));
});

test('raster: ogni cella toccata da una linea casuale è davvero attraversata (confronto con campionamento fitto)', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 20;
  for (let k = 0; k < 200; k++) {
    const [x0, y0, x1, y1] = [rand(), rand(), rand(), rand()];
    const got = cells((v) => traverseSegment(x0, y0, x1, y1, v));
    const sampled = new Set();
    for (let s = 0; s <= 4000; s++) { const t = s / 4000; sampled.add(`${Math.floor(y0 + t * (y1 - y0))},${Math.floor(x0 + t * (x1 - x0))}`); }
    for (const c of sampled) assert.ok(got.has(c), `cella ${c} mancante per ${[x0, y0, x1, y1].map((x) => x.toFixed(2))}`);
    assert.ok(got.size <= sampled.size + 2, 'troppe celle');
  }
});

test('raster: poligono quadrato riempito', () => {
  const sq = [[1, 1], [4, 1], [4, 4], [1, 4], [1, 1]];
  const s = cells((v) => rasterizePolygon(sq, 10, 10, v));
  for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) assert.ok(s.has(`${r},${c}`), `interno ${r},${c}`);
  assert.ok(!s.has('6,6'));
});

test('classificazione OSM: asfalto ferma il fuoco, piste no; il fondo indicato prevale', () => {
  assert.equal(classify({ highway: 'secondary' }).code, BARRIER.ROAD);
  assert.equal(classify({ highway: 'unclassified', surface: 'gravel' }).code, BARRIER.TRACK);
  assert.equal(classify({ highway: 'track' }).code, BARRIER.TRACK);
  assert.equal(classify({ highway: 'track', surface: 'asphalt' }).code, BARRIER.ROAD);
  assert.equal(classify({ natural: 'water' }).code, BARRIER.WATER);
  assert.equal(classify({ railway: 'rail' }).code, BARRIER.RAIL);
  assert.equal(classify({ building: 'yes' }), null);
});

test('buildBarriers: una strada OSM attraversa la griglia senza interruzioni', () => {
  const manifest = { rows: 50, cols: 50, resolution_m: 10, crs: 'EPSG:32633', origin_utm: { x: 639000, y: 4530000 } };
  const a = utmToLatLon(639003, 4529750), b = utmToLatLon(639497, 4529760);   // da Ovest a Est, leggermente inclinata
  const osm = { elements: [{ type: 'way', tags: { highway: 'tertiary' }, geometry: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }] }] };
  const { layer } = buildBarriers(manifest, osm);
  for (let c = 0; c < 50; c++) {
    let hit = false;
    for (let r = 0; r < 50; r++) if (layer[r * 50 + c] === BARRIER.ROAD) hit = true;
    assert.ok(hit, `colonna ${c} senza strada`);
  }
});

test('npy: scrittura e rilettura identiche (uint8 e float32)', () => {
  const u = Uint8Array.from([0, 1, 4, 255, 2, 3]);
  const p = parseNpy(writeNpy(u, [2, 3]).buffer);
  assert.deepEqual(p.shape, [2, 3]); assert.deepEqual([...p.data], [...u]);
  const f = Float32Array.from([1.5, -2, 3.25]);
  assert.deepEqual([...parseNpy(writeNpy(f, [3]).buffer).data], [...f]);
});

test('motore: una strada asfaltata ferma il fuoco; senza barriere il fuoco passa', () => {
  const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  const g = uniformGrid(81, 81, { fuel: 1, ndvi: 0.5 });
  g.barriers = new Uint8Array(g.n);
  for (let r = 0; r < 81; r++) g.barriers[r * 81 + 50] = BARRIER.ROAD;        // strada Nord-Sud larga una cella
  for (let r = 0; r < 81; r++) g.barriers[r * 81 + 30] = BARRIER.TRACK;       // pista: non deve fermare
  const wx = makeWeather({ wind: { speed: 8, from: 270 } });
  const job = { ignitions: [{ r: 40, c: 10 }], maxMin: 600 };
  const on = simulate(g, models, job, wx).arrival, off = simulate(g, models, { ...job, barriers: false }, wx).arrival;
  let beyondOn = 0, beyondOff = 0, pastTrack = 0;
  for (let r = 0; r < 81; r++) {
    for (let c = 51; c < 81; c++) { if (Number.isFinite(on[r * 81 + c])) beyondOn++; if (Number.isFinite(off[r * 81 + c])) beyondOff++; }
    for (let c = 31; c < 50; c++) if (Number.isFinite(on[r * 81 + c])) pastTrack++;
  }
  assert.equal(beyondOn, 0, 'il fuoco ha superato la strada');
  assert.ok(beyondOff > 100, 'senza barriere il fuoco dovrebbe passare');
  assert.ok(pastTrack > 100, 'la pista non deve fermare il fuoco');
  assert.equal(withBarriers(g).fuel[40 * 81 + 50], 0);
  assert.equal(g.fuel[40 * 81 + 50], 1, 'la griglia originale resta intatta');
});

// --- Barriere attraversabili (D46): salto se la larghezza è minore di 2 · lunghezza di fiamma (+4 m oltre 5 m/s)
function roadGrid(widthM) {
  const g = uniformGrid(81, 81, { fuel: 1, ndvi: 0.5 });
  g.barriers = new Uint8Array(g.n); g.barrierWidth = new Uint8Array(g.n);
  for (let r = 0; r < 81; r++) { g.barriers[r * 81 + 50] = BARRIER.ROAD; g.barrierWidth[r * 81 + 50] = widthM; }   // strada Nord-Sud
  return g;
}
const beyond = (arr) => { let k = 0; for (let r = 0; r < 81; r++) for (let c = 51; c < 81; c++) if (Number.isFinite(arr[r * 81 + c])) k++; return k; };
const MODELS_FM = () => parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));

test('barriere attraversabili: con vento forte la testa del fuoco salta una strada stretta', () => {
  const g = roadGrid(5), job = { ignitions: [{ r: 40, c: 10 }], maxMin: 600 };
  const r = simulate(g, MODELS_FM(), job, makeWeather({ wind: { speed: 8, from: 270, gust: 12 } }));
  assert.ok(beyond(r.arrival) > 100, 'il fuoco doveva superare la strada');
  assert.ok(r.crossings > 0);
});

test('barriere attraversabili: con vento debole la stessa strada ferma il fuoco', () => {
  const g = roadGrid(5), job = { ignitions: [{ r: 40, c: 10 }], maxMin: 600 };
  const r = simulate(g, MODELS_FM(), job, makeWeather({ wind: { speed: 1, from: 270 } }));
  assert.equal(beyond(r.arrival), 0);
});

test('barriere attraversabili: una barriera invalicabile (255) o la modalità assoluta fermano sempre', () => {
  const wx = makeWeather({ wind: { speed: 12, from: 270, gust: 20 } }), job = { ignitions: [{ r: 40, c: 10 }], maxMin: 600 };
  assert.equal(beyond(simulate(roadGrid(255), MODELS_FM(), job, wx).arrival), 0, 'invalicabile');
  assert.equal(beyond(simulate(roadGrid(5), MODELS_FM(), { ...job, barriers: 'assolute' }, wx).arrival), 0, 'assolute');
});

test('barriere attraversabili: le celle di strada non bruciano mai, il salto accende solo la cella oltre', () => {
  // vento da Sud parallelo alla strada: il fronte arriva sul fianco, la fascia di 5 m resta intatta
  const g = roadGrid(5), job = { ignitions: [{ r: 70, c: 45 }], maxMin: 600 };
  const r = simulate(g, MODELS_FM(), job, makeWeather({ wind: { speed: 8, from: 180, gust: 9 } }));
  let roadBurnt = 0;
  for (let rr = 0; rr < 81; rr++) if (Number.isFinite(r.arrival[rr * 81 + 50])) roadBurnt++;
  assert.equal(roadBurnt, 0, 'le celle di strada non bruciano mai');
});

test('larghezza delle barriere: tag OSM width se presente, altrimenti valore per classe; solo laghi e invasi invalicabili', () => {
  assert.equal(widthOf({ highway: 'tertiary' }), 7);
  assert.equal(widthOf({ highway: 'tertiary', width: '4.5' }), 5);
  assert.equal(widthOf({ highway: 'trunk' }), 25);
  assert.equal(widthOf({ highway: 'motorway', width: '6' }), 6);
  assert.equal(widthOf({ natural: 'water' }), 255);
  assert.equal(widthOf({ waterway: 'river' }), 15);
});
