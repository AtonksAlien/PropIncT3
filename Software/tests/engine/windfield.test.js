// Test della lettura di un campo di vento esterno (griglie ASCII di WindNinja, P37).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsc, prepareRun, windFieldFor, windNinjaSpeedUnit } from '../../engine/windfield.js';
import { uniformGrid } from '../../engine/grid.js';

const asc = (ncols, nrows, xll, yll, cell, f) => {
  const rows = [];
  for (let r = 0; r < nrows; r++) rows.push(Array.from({ length: ncols }, (_, c) => f(r, c)).join(' '));
  return `ncols ${ncols}\nnrows ${nrows}\nxllcorner ${xll}\nyllcorner ${yll}\ncellsize ${cell}\nNODATA_value -9999\n${rows.join('\n')}\n`;
};

test('griglia ASCII: intestazione, valori e nodata', () => {
  const g = parseAsc(asc(3, 2, 1000, 2000, 50, (r, c) => (r === 1 && c === 2 ? -9999 : r * 10 + c)));
  assert.equal(g.ncols, 3); assert.equal(g.nrows, 2); assert.equal(g.ymax, 2100);
  assert.equal(g.data[4], 11); assert.ok(Number.isNaN(g.data[5]));
});

test('corsa uniforme: fattore e direzione ricostruiti; la corsa più vicina viene ruotata', () => {
  const grid = uniformGrid(20, 20, { res: 10 });
  grid.manifest = { origin_utm: { x: 500000, y: 4500000 } };
  // griglia di WindNinja a 50 m che copre la zona: 9 m/s da 250° con vento in ingresso di 6 m/s
  const vel = parseAsc(asc(6, 6, 499950, 4499750, 50, () => 9));
  const ang = parseAsc(asc(6, 6, 499950, 4499750, 50, () => 250));
  const run = prepareRun(grid, { fromDeg: 270, speed: 6, vel, ang });
  assert.ok(Math.abs(run.factor[0] - 1.5) < 1e-5);
  assert.ok(Math.abs(run.from[210] - 250) < 1e-3);
  const w = windFieldFor([run, { ...run, fromDeg: 300 }], 275);
  assert.equal(w.runFrom, 270);
  assert.ok(Math.abs(w.from(210) - 255) < 1e-3, 'ruotata di +5°');
});

test('velocità di WindNinja in miglia orarie se la configurazione non dice altro', () => {
  assert.equal(windNinjaSpeedUnit('input_speed = 6\ninput_speed_units = mps\n'), 'mph');
  assert.equal(windNinjaSpeedUnit('output_speed_units = mps\n'), 'mps');
  const grid = uniformGrid(10, 10, { res: 10 });
  grid.manifest = { origin_utm: { x: 0, y: 1000 } };
  const vel = parseAsc(asc(4, 4, -50, 850, 50, () => 13.4216)), ang = parseAsc(asc(4, 4, -50, 850, 50, () => 270));
  const run = prepareRun(grid, { fromDeg: 270, speed: 6, vel, ang, velUnit: 'mph' });
  assert.ok(Math.abs(run.factor[55] - 1) < 1e-3, '13,42 mph = 6 m/s');
});
