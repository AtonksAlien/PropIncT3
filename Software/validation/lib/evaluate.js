// Valutazione di un caso: modello (Rothermel + tempo di arrivo) contro l'area bruciata osservata, con i riferimenti ingenui.
// Funzione pura (niente file né rete): la usano validate.js e i test.

import { simulate } from '../../engine/simulate.js';
import { maskAt, areaMatchedMask, confusion, skill, cellsToHa } from './metrics.js';
import { ellipseMask, meanWind } from './baselines.js';
import { hotspotTiming } from './hotspots.js';

/**
 * @param o.grid, o.models, o.weather   come per engine/simulate.js
 * @param o.ignitions  [{ r, c }]
 * @param o.obsMask    maschera dell'area osservata (rasterizePerimeter)
 * @param o.maxMin     durata simulata (minuti); deve coprire l'incendio intero
 * @param o.tEndMin    istante della fine osservata (minuti dall'innesco), per il confronto "a fine incendio"
 * @param o.hotspots   punti caldi FIRMS già letti (facoltativi) e o.startMs = innesco in ms UTC
 */
export function evaluate(o) {
  const { grid, models, weather, ignitions, obsMask, maxMin, tEndMin = maxMin, barriers = true, liveNdvi = true, terrainWind = false, fuelNdvi = false,
    hotspots = null, startMs = 0, tolMin = 60, onProgress = () => {} } = o;
  const domain = new Uint8Array(grid.n);
  let K = 0, obsAll = 0;
  for (let i = 0; i < grid.n; i++) {
    domain[i] = grid.fuel[i] > 0 ? 1 : 0;
    if (obsMask[i]) { obsAll++; if (domain[i]) K++; }
  }

  const score = (arrival) => {
    const am = areaMatchedMask(arrival, domain, K);
    return {
      areaMatched: { ...confusion(obsMask, am.mask, domain), tMin: am.tMin },
      atEnd: { ...confusion(obsMask, maskAt(arrival, tEndMin), domain), tMin: tEndMin },
      burnedHaEnd: cellsToHa(count(maskAt(arrival, tEndMin), domain), grid.res),
    };
  };

  onProgress('modello C (Rothermel + tempo minimo di arrivo)');
  const c = simulate(grid, models, { ignitions, maxMin, barriers, liveNdvi, terrainWind, fuelNdvi }, weather);
  const C = { ...score(c.arrival), ms: c.ms };
  if (hotspots) C.hotspots = hotspotTiming(grid, c.arrival, hotspots, startMs, maxMin, { tolMin });

  onProgress('riferimenti: cerchio ed ellisse del vento medio');
  const wind = meanWind(weather, tEndMin);
  const circle = ellipseMask(grid, domain, ignitions[0], K, 0, 1);
  const ellipse = ellipseMask(grid, domain, ignitions[0], K, wind.head, wind.lw);
  const baselines = {
    circle: confusion(obsMask, circle.mask, domain),
    ellipse: { ...confusion(obsMask, ellipse.mask, domain), wind },
  };
  const ref = baselines.ellipse.sorensen;
  const skills = { C: skill(C.areaMatched.sorensen, ref) };

  return {
    observed: { cells: obsAll, cellsBurnable: K, ha: cellsToHa(obsAll, grid.res), haBurnable: cellsToHa(K, grid.res) },
    C, baselines, skills,
    masks: { observed: obsMask, C: areaMatchedMask(c.arrival, domain, K).mask, domain },
    arrival: c.arrival,
  };
}

function count(mask, domain) { let k = 0; for (let i = 0; i < mask.length; i++) if (mask[i] && domain[i]) k++; return k; }
