// Test di Rothermel contro i valori di riferimento della libreria Behave (US Forest Service, base di BehavePlus):
// https://github.com/firelab/behave, src/testBehave/testBehave.cpp (testSurfaceSingleFuelModel, testSurfaceWindLimit).
// Stessi ingressi, stesse unità (velocità in catene/ora = 1,1 ft/min), tolleranza 1e-6 come nell'originale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuelbed, spread, windAdjustmentFactor, midflameFtMin } from '../../engine/rothermel.js';
import { parseFuelModels } from '../../engine/fuels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = 2000 / 43560;   // t/acre → lb/ft², come nei record di Behave
const RAD = Math.PI / 180;

// Record di Behave (fuelModels.cpp): GS4 è dinamico e ha tutte le classi; FM1 e FM4 sono Anderson.
const GS4 = { depth: 2.1, mxDead: 0.40, w1: 1.9 * F, w10: 0.3 * F, w100: 0.1 * F, wHerb: 3.4 * F, wWoody: 7.1 * F, sav1: 1800, savHerb: 1600, savWoody: 1600, dynamic: true };
const FM1 = { depth: 1.0, mxDead: 0.12, w1: 0.034, w10: 0, w100: 0, wHerb: 0, wWoody: 0, sav1: 3500, savHerb: 1500, savWoody: 1500 };
const FM4 = { depth: 6.0, mxDead: 0.20, w1: 0.230, w10: 0.184, w100: 0.092, wHerb: 0, wWoody: 0.230, sav1: 2000, savHerb: 1500, savWoody: 1500 };
const LOW = { m1: 0.06, m10: 0.07, m100: 0.08, herb: 0.60, woody: 0.90 };   // scenario "low moisture" dei test

/** Come nei test di Behave: vento 5 mi/h a 20 ft, chiome 30 ft con crown ratio 0,5, direzioni riferite al Nord. */
function behaveRun(model, { cover = 0.5, slopeTan, windFrom, aspect }) {
  const fb = fuelbed(model, LOW);
  const waf = windAdjustmentFactor(model.depth, cover, 30, 0.5);
  return { fb, ...spread(fb, 5 * 88 * waf, (windFrom + 180) % 360, slopeTan, aspect) };
}
const chainsPerHour = (ftMin) => ftMin / 1.1;
const eq6 = (obs, exp, name) => assert.ok(Math.abs(obs - exp) < 1e-6, `${name}: ${obs.toFixed(6)} invece di ${exp}`);

test('Behave GS4: vento 45°, esposizione 95°, pendenza 30° — velocità e grandezze intermedie', () => {
  const r = behaveRun(GS4, { slopeTan: Math.tan(30 * RAD), windFrom: 45, aspect: 95 });
  eq6(chainsPerHour(r.ros), 19.677584, 'velocità (ch/h)');
  eq6(r.fb.sigma, 1631.128734, 'SAV caratteristico (1/ft)');
  eq6(r.fb.mxLive * 100, 137.968551, 'umidità di estinzione viva (%)');
  eq6(r.fb.mLive * 100, 85.874007, 'umidità viva pesata (%)');
  eq6(r.fb.mDead * 100, 6.005463, 'umidità morta pesata (%)');
  eq6(r.fb.IR * r.fb.xi * (1 + r.phiW + r.phiS), 5177.248579, 'sorgente di calore (BTU/ft²/min)');
});

test('Behave GS4: combinazione vettoriale di vento e pendenza (30%)', () => {
  const cases = [
    { windFrom: 0, aspect: 0, exp: 8.876216, name: 'vento da N su versante esposto a N (vento in salita)' },
    { windFrom: 45, aspect: 215, exp: 4.113265, name: 'vento da NE, esposizione 215°' },
    { windFrom: 45, aspect: 5, exp: 8.503960, name: 'vento da NE, esposizione 5°' },
    { windFrom: 90, aspect: 0, exp: 7.091665, name: 'vento trasversale al pendio' },
  ];
  for (const c of cases) eq6(chainsPerHour(behaveRun(GS4, { slopeTan: 0.3, ...c }).ros), c.exp, c.name);
});

test('Behave FM4 (Anderson): chiome al 40%, vento da Est, pendenza 30°', () => {
  eq6(chainsPerHour(behaveRun(FM4, { cover: 0.4, slopeTan: Math.tan(30 * RAD), windFrom: 90, aspect: 0 }).ros), 46.631688, 'FM4');
});

test('Behave FM1: vento a metà fiamma 20 mi/h, con e senza limite del vento', () => {
  const fb = fuelbed(FM1, LOW);
  const near = (a, b, name) => assert.ok(Math.abs(a - b) < 1e-2, `${name}: ${a} invece di ${b}`);
  near(0.9 * fb.IR, 743.5194, 'limite = 0,9 · I_R (ft/min)');
  near(spread(fb, 1760, 180, 0, 0).ros, 1747.279440, 'senza limite, piano');
  const lim = spread(fb, 1760, 180, 0, 0, { windLimit: true });
  near(lim.ros, 297.099053, 'con limite'); assert.ok(lim.limited);
  near(spread(fb, 1760, 180, 0.3, 0, { windLimit: true }).ros, 297.099053, 'con limite, pendenza 30%');
  near(spread(fb, 1760, 180, 0.3, 0).ros, 1764.333376, 'senza limite, pendenza 30%');
});

test('fuel_models.csv: i parametri coincidono con i record di Behave (FM1, FM4)', () => {
  const m = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  for (const [ours, ref] of [[m[1].us, FM1], [m[4].us, FM4]]) {
    for (const k of ['depth', 'mxDead', 'w1', 'w10', 'w100', 'wWoody', 'sav1']) {
      // Behave arrotonda i carichi a 3 decimali in lb/ft²: differenze sotto lo 0,5%
      assert.ok(Math.abs(ours[k] - ref[k]) <= 0.005 * Math.max(ref[k], 1e-9) + 1e-9, `${k}: ${ours[k]} vs ${ref[k]}`);
    }
  }
});

test('direzione: solo vento → sottovento; solo pendenza → verso monte; nessuno dei due → R0', () => {
  const m = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  const fb = fuelbed(m[10].us, LOW);
  const w = spread(fb, 300, 60, 0, -1);
  assert.ok(Math.abs(w.dir - 60) < 1e-9 && w.ros > fb.R0);
  const s = spread(fb, 0, 0, 0.4, 135);              // versante che scende verso SE → si sale verso NO
  assert.ok(Math.abs(s.dir - 315) < 1e-9 && s.ros > fb.R0);
  assert.equal(spread(fb, 0, 0, 0, -1).ros, fb.R0);
});

test('umidità: più umido → più lento; oltre l\'umidità di estinzione → non brucia', () => {
  const m = parseFuelModels(readFileSync(join(ROOT, 'pipeline/tables/fuel_models.csv'), 'utf8'));
  const r0 = (m1) => fuelbed(m[1].us, { ...LOW, m1 }).R0;
  assert.ok(r0(0.03) > r0(0.06) && r0(0.06) > r0(0.10));
  assert.equal(r0(0.12), 0);                          // FM1: estinzione al 12%
  assert.equal(fuelbed({ ...FM1, w1: 0 }, LOW), null); // senza carico: non combustibile
});

test('vento: fattore di riduzione e conversione da 10 m a metà fiamma', () => {
  // scoperto, FM1 (1 ft): 1,83 / ln((20 + 0,36) / 0,13) = 0,3621 (tabulato 0,36 per il modello 1)
  assert.ok(Math.abs(windAdjustmentFactor(1) - 0.3621) < 1e-4);
  // sotto chioma (50%, 30 ft, crown ratio 0,5) il vento è ridotto molto di più
  assert.ok(windAdjustmentFactor(1, 0.5, 30, 0.5) < 0.2);
  // 10 m/s a 10 m, WAF 1 → 10/1,15 m/s = 1712 ft/min
  assert.ok(Math.abs(midflameFtMin(10, 1) - (10 / 1.15) * 60 / 0.3048) < 1e-9);
});
