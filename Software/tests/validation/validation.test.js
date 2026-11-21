// Test dello strumento di validazione: perimetro → celle, metriche, riferimenti, punti caldi, valutazione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uniformGrid, cellToLatLon } from '../../engine/grid.js';
import { parseFuelModels } from '../../engine/fuels.js';
import { makeWeather, simulate } from '../../engine/simulate.js';
import { rasterizePerimeter } from '../../validation/lib/perimeter.js';
import { confusion, areaMatchedMask, maskAt, skill } from '../../validation/lib/metrics.js';
import { ellipseMask, meanWind } from '../../validation/lib/baselines.js';
import { parseFirms, hotspotTiming } from '../../validation/lib/hotspots.js';
import { evaluate } from '../../validation/lib/evaluate.js';
import { runEnsemble, perturbWeather } from '../../validation/lib/ensemble.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
const X0 = 600000, Y0 = 4500000;

/** Griglia uniforme georeferenziata (UTM 33N, angolo NO in X0, Y0). */
function geoGrid(rows, cols, opts) {
  const g = uniformGrid(rows, cols, opts);
  g.manifest = { crs: 'EPSG:32633', origin_utm: { x: X0, y: Y0 } };
  return g;
}
const utmPoly = (rings) => ({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32633' } },
  features: [{ type: 'Feature', properties: { grado: 'distrutto' }, geometry: { type: 'Polygon', coordinates: rings } }] });
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

test('perimetro in UTM: un quadrato di 200 × 100 m copre 20 × 10 celle', () => {
  const g = geoGrid(50, 50);
  const p = rasterizePerimeter(g, utmPoly([square(X0 + 100, Y0 - 300, X0 + 300, Y0 - 200)]));
  assert.equal(p.cells, 200);
  assert.equal(p.mask[25 * 50 + 10], 1);   // riga 25 = 250 m a sud, colonna 10 = 105 m a est (centro 105 m)
  assert.equal(p.mask[25 * 50 + 9], 0);
  assert.equal(p.cut, false);
});

test('perimetro: il buco resta escluso, il filtro scarta gli elementi, i bordi fuori griglia sono segnalati', () => {
  const g = geoGrid(50, 50);
  const holed = rasterizePerimeter(g, utmPoly([square(X0 + 100, Y0 - 300, X0 + 300, Y0 - 100), square(X0 + 150, Y0 - 250, X0 + 250, Y0 - 150)]));
  assert.equal(holed.cells, 400 - 100);
  const none = rasterizePerimeter(g, utmPoly([square(X0 + 100, Y0 - 300, X0 + 300, Y0 - 100)]), { filter: { field: 'grado', values: ['lieve'] } });
  assert.equal(none.cells, 0);
  const cut = rasterizePerimeter(g, utmPoly([square(X0 - 100, Y0 - 100, X0 + 100, Y0 + 50)]));
  assert.equal(cut.cut, true);
  assert.equal(cut.cells, 10 * 10);
});

test('perimetro in lon/lat (WGS84) uguale allo stesso perimetro in UTM', () => {
  const g = geoGrid(60, 60);
  const ring = [[10, 10], [10, 50], [40, 50], [40, 10], [10, 10]].map(([r, c]) => { const p = cellToLatLon(g, r, c); return [p.lon, p.lat]; });
  const ll = rasterizePerimeter(g, { type: 'Polygon', coordinates: [ring] });
  assert.ok(Math.abs(ll.cells - 30 * 40) <= 40, `${ll.cells} celle invece di circa 1200`);
  assert.throws(() => rasterizePerimeter(g, { type: 'Polygon', coordinates: [square(X0, Y0, X0 + 50, Y0 + 50)] }), /EPSG:4326/);
});

test('metriche: conteggi, Sørensen, Jaccard, precisione, recall, kappa', () => {
  const obs = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  const sim = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
  const dom = new Uint8Array(10).fill(1);
  const m = confusion(obs, sim, dom);
  assert.deepEqual([m.tp, m.fp, m.fn, m.tn], [2, 1, 2, 5]);
  assert.equal(m.sorensen, 4 / 7);
  assert.equal(m.jaccard, 2 / 5);
  assert.equal(m.precision, 2 / 3);
  assert.equal(m.recall, 2 / 4);
  assert.equal(m.areaRatio, 3 / 4);
  // po = 0,7; pe = (3·4 + 7·6)/100 = 0,54 → kappa = 0,16/0,46
  assert.ok(Math.abs(m.kappa - 0.16 / 0.46) < 1e-12);
  // fuori dominio non conta
  const dom2 = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
  assert.equal(confusion(obs, sim, dom2).fp, 0);
  assert.ok(Math.abs(skill(0.7, 0.5) - 0.4) < 1e-12);
});

test('area uguale: si prendono le K celle raggiunte per prime', () => {
  const arr = Float32Array.from([5, 1, Infinity, 3, 2, 9]);
  const dom = Uint8Array.from([1, 1, 1, 1, 1, 0]);
  const { mask, tMin } = areaMatchedMask(arr, dom, 3);
  assert.equal(tMin, 3);
  assert.deepEqual([...mask], [0, 1, 0, 1, 1, 0]);
  assert.equal(areaMatchedMask(arr, dom, 9).tMin, null);   // il modello non arriva all'area osservata
  assert.deepEqual([...maskAt(arr, 2)], [0, 1, 0, 0, 1, 0]);
});

test("riferimenti: cerchio ed ellisse con l'area giusta, ellisse spostata sottovento", () => {
  const g = geoGrid(120, 120), dom = new Uint8Array(g.n).fill(1), ign = { r: 60, c: 60 };
  const circ = ellipseMask(g, dom, ign, 1000, 0, 1);
  const ell = ellipseMask(g, dom, ign, 1000, 90, 3);   // vento verso est
  const stats = (m) => { let k = 0, sc = 0; for (let i = 0; i < g.n; i++) if (m[i]) { k++; sc += i % g.cols; } return { k, cMean: sc / k }; };
  const sc = stats(circ.mask), se = stats(ell.mask);
  assert.ok(sc.k >= 1000 && sc.k < 1040, `cerchio: ${sc.k} celle`);
  assert.ok(se.k >= 1000 && se.k < 1040, `ellisse: ${se.k} celle`);
  assert.ok(Math.abs(sc.cMean - 60) < 0.5, 'il cerchio è centrato sull\'innesco');
  assert.ok(se.cMean > 70, `l'ellisse si sviluppa verso est (colonna media ${se.cMean.toFixed(1)})`);
  assert.equal(ell.mask[60 * 120 + 50], 0, "a 100 m sopravento l'ellisse non arriva");
  const w = meanWind(makeWeather({ wind: { speed: 5, from: 270 } }), 60);
  assert.ok(Math.abs(w.head - 90) < 1e-9 && Math.abs(w.speed - 5) < 1e-9 && w.lw > 1);
});

test('punti caldi FIRMS: lettura del CSV ed esito rispetto al tempo di arrivo', () => {
  const g = geoGrid(100, 100);
  const ll = (r, c) => { const p = cellToLatLon(g, r, c); return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`; };
  const csv = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence\n'
    + `${ll(50, 50)},330,0.39,0.36,2023-07-25,1200,N,VIIRS,n\n`
    + `${ll(50, 99)},330,0.39,0.36,2023-07-25,1200,N,VIIRS,n\n`
    + `${ll(10, 10)},330,0.39,0.36,2023-07-25,1500,N,VIIRS,n\n`
    + `${ll(50, 50)},330,0.39,0.36,2023-07-25,945,N,VIIRS,n\n`;
  const hs = parseFirms(csv);
  assert.equal(hs.length, 4);
  assert.equal(hs[3].time.toISOString(), '2023-07-25T09:45:00.000Z');
  assert.equal(hs[0].sizeKm, 0.39);
  // arrivo: colonna c raggiunta al minuto c (fronte che avanza verso est a 10 m/min), riga 10 mai
  const arr = new Float32Array(g.n).fill(Infinity);
  for (let r = 30; r < 70; r++) for (let c = 0; c < 100; c++) arr[r * 100 + c] = c;
  const start = Date.UTC(2023, 6, 25, 11, 0);
  const { points, summary } = hotspotTiming(g, arr, hs, start, 180, { tolMin: 15 });
  assert.equal(points[0].status, 'coerente');        // passaggio dopo 60 min, pixel raggiunto dal minuto 30
  assert.equal(points[1].status, 'in ritardo');      // pixel raggiunto dal minuto 79, passaggio al 60: 19 min oltre la tolleranza di 15
  assert.equal(points[2].status, 'dopo la fine simulata');
  assert.equal(points[3].status, "prima dell'innesco");
  assert.equal(summary.used, 2);
  assert.equal(summary.late, 0.5);
});

test("valutazione: se l'osservato è il modello stesso, il Sørensen ad area uguale è 1 e batte i riferimenti", () => {
  const g = geoGrid(150, 150, { fuel: 1 });
  for (let r = 0; r < 150; r++) for (let c = 95; c < 100; c++) if (r < 60 || r > 70) g.fuel[r * 150 + c] = 0;   // muro con un varco
  const weather = makeWeather({ wind: { speed: 4, from: 270 }, durMin: 120 });
  const ign = [{ r: 75, c: 40 }];
  const truth = simulate(g, MODELS, { ignitions: ign, maxMin: 120, barriers: false }, weather);
  const obs = maskAt(truth.arrival, 60);
  const res = evaluate({ grid: g, models: MODELS, weather, ignitions: ign, obsMask: obs, maxMin: 120, tEndMin: 60, barriers: false });
  assert.equal(res.C.areaMatched.sorensen, 1);
  assert.equal(res.C.atEnd.sorensen, 1);
  assert.ok(Math.abs(res.C.areaMatched.tMin - 60) <= 1);
  assert.ok(res.baselines.ellipse.sorensen < 1 && res.skills.C === 1);
});

test('insieme di simulazioni: probabilità tra 0 e 1, riproducibile con lo stesso seme, vento perturbato', () => {
  const g = geoGrid(80, 80, { fuel: 1 });
  const wx = makeWeather({ wind: { speed: 4, from: 270 }, durMin: 120 });
  const p = perturbWeather(wx, 1.5, 10).at(0);
  assert.ok(Math.abs(p.ws10 - 6) < 1e-9 && Math.abs(p.from - 280) < 1e-9);
  const truth = simulate(g, MODELS, { ignitions: [{ r: 40, c: 20 }], maxMin: 120, barriers: false }, wx);
  const obs = maskAt(truth.arrival, 40);
  const opts = { grid: g, models: MODELS, obsMask: obs, maxMin: 120, barriers: false, liveNdvi: false,
    makeWx: () => wx, ignition: { r: 40, c: 20 }, snap: (c) => c, members: 6, radiusM: 50, windPct: 0.2, windDeg: 10 };
  const a = runEnsemble(opts), b = runEnsemble(opts);
  assert.equal(a.runs.length, 6);
  assert.ok(a.prob.every((v) => v >= 0 && v <= 1));
  assert.deepEqual(a.runs.map((r) => r.sorensen), b.runs.map((r) => r.sorensen), 'stesso seme, stessi risultati');
  assert.ok(a.summary.sorensen.median > 0.5, 'perturbazioni piccole: forma vicina all\'osservato');
});
