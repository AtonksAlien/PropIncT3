// Test della proiezione UTM (engine/geo.js) contro valori noti e contro PROJ (via rasterio nella pipeline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToUtm, utmToLatLon, utmZoneOf } from '../../engine/geo.js';
import { latLonToCell, cellToLatLon } from '../../engine/grid.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('UTM: valori noti sul meridiano centrale', () => {
  assert.deepEqual(latLonToUtm(0, 15), { x: 500000, y: 0 });
  // 45° N: arco di meridiano WGS84 4 984 944,378 m × k0 0,9996 = 4 982 950,400 m
  assert.ok(Math.abs(latLonToUtm(45, 15).y - 4982950.400) < 0.01);
  assert.equal(utmZoneOf('EPSG:32633'), 33);
  assert.throws(() => utmZoneOf('EPSG:4326'));
});

test('UTM: andata e ritorno con errore sotto il millimetro su tutta la zona', () => {
  for (let x = 639000; x <= 645000; x += 1500) for (let y = 4524000; y <= 4530000; y += 1500) {
    const p = utmToLatLon(x, y), q = latLonToUtm(p.lat, p.lon);
    assert.ok(Math.abs(q.x - x) < 1e-3 && Math.abs(q.y - y) < 1e-3, `${x},${y} → ${q.x},${q.y}`);
  }
});

const manifestPath = join(ROOT, 'data/zones/mercadante/processed/manifest.json');
test('UTM: angoli della zona uguali ai confini calcolati da PROJ nella pipeline', { skip: !existsSync(manifestPath) && 'pacchetto assente' }, () => {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const [[latMin, lonMin], [latMax, lonMax]] = m.bounds_wgs84;   // rasterio.warp.transform_bounds
  const b = m.bounds_utm;
  const nw = utmToLatLon(b.xmin, b.ymax), ne = utmToLatLon(b.xmax, b.ymax);
  const sw = utmToLatLon(b.xmin, b.ymin), se = utmToLatLon(b.xmax, b.ymin);
  const tol = 1e-6;   // circa 10 cm
  assert.ok(Math.abs(nw.lat - latMax) < tol, 'Nord (angolo NO)');
  assert.ok(Math.abs(se.lat - latMin) < tol, 'Sud (angolo SE)');
  assert.ok(Math.abs(sw.lon - lonMin) < tol, 'Ovest (angolo SO)');
  assert.ok(Math.abs(ne.lon - lonMax) < tol, 'Est (angolo NE)');
  // la griglia è ruotata di circa 1,1° rispetto ai meridiani: il bordo Ovest si sposta di ~110 m in longitudine
  const shift = (nw.lon - sw.lon) * 111320 * Math.cos((40.88 * Math.PI) / 180);
  assert.ok(shift > 100 && shift < 125, `spostamento ${shift.toFixed(0)} m`);
});

test('griglia: lat/lon → cella → centro cella → stessa cella', () => {
  const grid = { rows: 600, cols: 600, res: 10, manifest: { crs: 'EPSG:32633', origin_utm: { x: 639000, y: 4530000 } } };
  for (const [r, c] of [[0, 0], [0, 599], [599, 0], [599, 599], [271, 294]]) {
    const p = cellToLatLon(grid, r, c);
    assert.deepEqual(latLonToCell(grid, p.lat, p.lon), { r, c });
  }
});
