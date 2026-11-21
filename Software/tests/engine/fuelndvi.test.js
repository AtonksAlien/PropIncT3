// Test del dettaglio del combustibile dall'NDVI estivo (DECISIONI D54).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otsu, withNdviFuel } from '../../engine/fuelndvi.js';
import { uniformGrid, withBarriers } from '../../engine/grid.js';

test('Otsu separa due gruppi di NDVI (erba secca 0,25, macchia 0,60)', () => {
  const vals = [];
  for (let k = 0; k < 1000; k++) vals.push(0.25 + 0.03 * Math.sin(k), 0.6 + 0.05 * Math.cos(k));
  const { t, separation } = otsu(vals);
  assert.ok(t > 0.3 && t < 0.55, `soglia ${t}`);
  assert.ok(separation > 0.9, `separazione ${separation}`);
});

test('erba verde → macchia, macchia secca → erba, bosco secco → erba con alberi; il non combustibile resta', () => {
  const g = uniformGrid(4, 4, { fuel: 1 });
  const set = (i, f, v) => { g.fuel[i] = f; g.ndvi[i] = v; };
  for (let i = 0; i < 16; i++) set(i, i < 8 ? 1 : 4, i < 8 ? 0.25 : 0.6);   // due gruppi
  set(0, 1, 0.7);    // erba verde
  set(15, 4, 0.2);   // radura nella macchia
  set(14, 9, 0.22);  // bosco secco
  set(13, 0, 0.8);   // non combustibile verde (es. coltura irrigata): resta non combustibile
  const r = withNdviFuel(g);
  assert.equal(r.fuel[0], 4);
  assert.equal(r.fuel[15], 1);
  assert.equal(r.fuel[14], 2);
  assert.equal(r.fuel[13], 0);
  assert.equal(r.fuel[3], 1);
  assert.equal(r.fuel[10], 4);
  assert.equal(g.fuel[0], 1, 'la griglia di partenza non cambia');
  assert.deepEqual(r.fuelNdvi.changed, { herbToShrub: 1, shrubToHerb: 1, litterToGrass: 1 });
});

test('le barriere si ricalcolano sul combustibile corretto', () => {
  const g = uniformGrid(2, 2, { fuel: 1 });
  g.ndvi.set([0.2, 0.25, 0.7, 0.75]);
  g.barriers = new Uint8Array(4); g.barrierWidth = new Uint8Array(4);
  withBarriers(g);                         // variante in cache sulla griglia di partenza
  const b = withBarriers(withNdviFuel(g));
  assert.equal(b.fuel[2], 4, 'la variante con barriere usa il combustibile corretto');
});
