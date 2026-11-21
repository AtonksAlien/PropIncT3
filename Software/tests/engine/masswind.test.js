// Test del vento a conservazione della massa in uno strato (DECISIONI D53).
// In piano il vento non cambia; il flusso nello strato si conserva (divergenza di h·u quasi nulla);
// una valle trasversale al vento lo fa ruotare verso il suo asse, tanto più quanto lo strato è basso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveMassWind, massWindFor } from '../../engine/masswind.js';
import { uniformGrid } from '../../engine/grid.js';

/** Valle rettilinea con asse a 45° (da SO a NE), creste alte 400 m a circa 300 m dall'asse. */
function valley(n = 300, res = 10) {
  const g = uniformGrid(n, n, { res });
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = (c - n / 2) * res, y = (n / 2 - r) * res, d = (x - y) / Math.SQRT2;
    g.elevation[r * n + c] = 400 * (1 - Math.exp(-(d * d) / (2 * 300 ** 2)));
  }
  return g;
}

test('in piano il vento resta uguale in velocità e direzione', () => {
  const g = uniformGrid(100, 100, { res: 10 });
  const w = massWindFor(g, 270, 500);
  for (const i of [0, 5050, 9999]) {
    assert.ok(Math.abs(w.factor(i) - 1) < 1e-9);
    assert.ok(Math.abs(w.from(i) - 270) < 1e-6);
  }
});

test('il flusso nello strato si conserva', () => {
  const g = valley(), blh = 300, s = solveMassWind(g, 270, blh);
  // ricostruisce h sulla griglia grossolana e la divergenza di h·u nei punti interni
  const { R, C, f, ratio, dirTo } = s, d = f * g.res;
  const z = new Float64Array(R * C);
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) z[Math.floor(r / f) * C + Math.floor(c / f)] += g.elevation[r * g.cols + c] / (f * f);
  const mean = z.reduce((a, b) => a + b, 0) / z.length;
  const h = z.map((v) => Math.max(mean + blh - v, 0.05 * blh));
  const u = (k) => ratio[k] * Math.sin((dirTo[k] * Math.PI) / 180), v = (k) => ratio[k] * Math.cos((dirTo[k] * Math.PI) / 180);
  const maxDiv = (uf, vf) => {
    let m = 0;
    for (let r = 2; r < R - 2; r++) for (let c = 2; c < C - 2; c++) {
      const k = r * C + c;
      m = Math.max(m, Math.abs((h[k + 1] * uf(k + 1) - h[k - 1] * uf(k - 1) + h[k - C] * vf(k - C) - h[k + C] * vf(k + C)) / (2 * d)));
    }
    return m;
  };
  const corrected = maxDiv(u, v), uniform = maxDiv(() => 1, () => 0);   // vento da Ovest = verso Est
  console.log(`divergenza massima: ${uniform.toExponential(2)} senza correzione, ${corrected.toExponential(2)} con`);
  assert.ok(corrected < 0.1 * uniform, `divergenza ${corrected} contro ${uniform} senza correzione`);
});

test('una valle trasversale incanala il vento, di più con lo strato basso', () => {
  const g = valley(), mid = (g.rows / 2) * g.cols + g.cols / 2;
  const dev = (blh) => 270 - massWindFor(g, 270, blh).from(mid);   // rotazione verso SO (asse della valle)
  const d200 = dev(200), d500 = dev(500), d2000 = dev(2000);
  assert.ok(d200 > d500 && d500 > d2000 && d2000 >= 0, `rotazioni ${d200}, ${d500}, ${d2000}`);
  assert.ok(d200 > 15 && d200 < 45, `rotazione con strato di 200 m: ${d200}°`);
  // in fondovalle (strato più spesso) il vento rallenta, sulla cresta accelera
  const w = massWindFor(g, 270, 200), ridge = (g.rows / 2) * g.cols + g.cols / 2 + 100;
  assert.ok(w.factor(mid) < 1 && w.factor(ridge) > 1);
});
