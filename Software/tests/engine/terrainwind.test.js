// Test del vento corretto dal rilievo (MicroMet, Liston & Elder 2006; DECISIONI D52).
// Casi che si verificano a mano: in piano nessuna correzione; su una collina la cresta accelera e la
// base rallenta; il versante esposto al vento accelera più di quello sottovento; fattore in [0,5; 1,5].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrainWindFor, curvature } from '../../engine/terrainwind.js';
import { spreadField } from '../../engine/spreadfield.js';
import { uniformGrid } from '../../engine/grid.js';
import { parseFuelModels } from '../../engine/fuels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const models = parseFuelModels(readFileSync(join(ROOT, 'pipeline', 'tables', 'fuel_models.csv'), 'utf8'));
const MOIST = { m1: 0.06, m10: 0.07, m100: 0.08, herb: 0.6, woody: 0.9 };

/** Collina gaussiana alta 200 m (deviazione standard 400 m) al centro di 2 × 2 km; pendenza ed esposizione esatte. */
function hill(n = 200, res = 10) {
  const g = uniformGrid(n, n, { res, fuel: 1 });
  const c0 = (n - 1) / 2, s = 400;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = (c - c0) * res, y = (c0 - r) * res, i = r * n + c;   // x verso Est, y verso Nord
    const z = 200 * Math.exp(-(x * x + y * y) / (2 * s * s));
    const dzdx = (-x / (s * s)) * z, dzdy = (-y / (s * s)) * z;
    g.elevation[i] = 300 + z;
    g.tanSlope[i] = Math.hypot(dzdx, dzdy);
    g.slope[i] = (Math.atan(g.tanSlope[i]) * 180) / Math.PI;
    // esposizione = direzione verso cui il terreno scende (opposta al gradiente)
    g.aspect[i] = g.tanSlope[i] < 1e-9 ? -1 : ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
  }
  return g;
}

test('in piano il vento non cambia', () => {
  const g = uniformGrid(50, 50, { fuel: 1 });
  const tw = terrainWindFor(g, 270);
  for (const i of [0, 1234, 2499]) {
    assert.equal(tw.factor(i), 1);
    assert.equal(tw.from(i), 270);
  }
  const a = spreadField(g, models, MOIST, { ws10: 6, from: 270 });
  const b = spreadField(g, models, MOIST, { ws10: 6, from: 270 }, { terrainWind: true });
  assert.deepEqual(b.ros, a.ros);
});

test('collina: la cresta accelera, la base rallenta, fattore tra 0,5 e 1,5', () => {
  const g = hill(), n = g.cols, mid = (n / 2) * n + n / 2;
  const curv = curvature(g, 500);
  assert.ok(curv[mid] > 0.4, `curvatura in cima ${curv[mid]}`);
  const tw = terrainWindFor(g, 270);
  assert.ok(tw.factor(mid) > 1.2, `cima ${tw.factor(mid)}`);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < g.n; i++) { const f = tw.factor(i); if (f < min) min = f; if (f > max) max = f; }
  assert.ok(min >= 0.5 - 1e-6 && max <= 1.5 + 1e-6, `fattore tra ${min} e ${max}`);
});

test('versante esposto al vento più veloce di quello sottovento; la direzione devia lungo il versante', () => {
  const g = hill(), n = g.cols, r = n / 2;
  const west = r * n + Math.round(n / 2 - 40), east = r * n + Math.round(n / 2 + 40);   // 400 m a O e a E della cima
  const tw = terrainWindFor(g, 270);   // vento da Ovest: il versante ovest è sopravvento
  assert.ok(tw.factor(west) > tw.factor(east) + 0.2, `sopravvento ${tw.factor(west)}, sottovento ${tw.factor(east)}`);
  // vento diritto contro il versante: nessuna deviazione; vento a 45° dalla pendenza: deviazione massima
  assert.ok(Math.abs(tw.from(west) - 270) < 0.5, `deviazione sul versante ovest ${tw.from(west) - 270}°`);
  const nw = Math.round(n / 2 - 28) * n + Math.round(n / 2 - 28);   // versante esposto a NO
  const d = ((tw.from(nw) - 270 + 540) % 360) - 180;
  assert.ok(Math.abs(d) > 1 && Math.abs(d) < 20, `deviazione ${d}°`);
});

test('con il vento corretto la propagazione in cresta è più veloce che senza', () => {
  const g = hill(), n = g.cols, mid = (n / 2) * n + n / 2;
  const a = spreadField(g, models, MOIST, { ws10: 6, from: 270 });
  const b = spreadField(g, models, MOIST, { ws10: 6, from: 270 }, { terrainWind: true });
  assert.ok(b.ros[mid] > a.ros[mid] * 1.2, `${b.ros[mid]} contro ${a.ros[mid]}`);
});
