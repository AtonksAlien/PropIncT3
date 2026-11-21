// Dettaglio a 10 m del combustibile dall'NDVI estivo di prima dell'evento (DECISIONI D54).
//
// CORINE è a 100 m (unità minima 25 ha): dentro un poligono "pascolo" ci sono macchie di arbusti, dentro
// un poligono "macchia" ci sono radure. In estate, nel clima mediterraneo, l'erba è secca e resta verde
// solo la vegetazione legnosa sempreverde: l'NDVI di Sentinel-2 a 10 m le separa.
// La soglia tra "erba secca" e "legnosa verde" è quella di Otsu (1979) sull'NDVI delle celle combustibili
// della zona: dipende solo dall'immagine, non dal risultato della simulazione.
//
//   erba (1, 3) ed erba con arbusti (2)  con NDVI sopra la soglia → macchia (4)
//   arbusti (4, 5, 6, 7)                  con NDVI sotto la soglia → erba (1)
//   lettiera di bosco (8, 9, 10)          con NDVI sotto la soglia → erba con alberi radi (2)
//
// Nessuna soglia per il suolo nudo: d'estate l'erba secca ha un NDVI troppo vicino a quello del suolo.
// Regola per la validazione: l'immagine deve essere di prima dell'incendio (WorldCover 2021 no, P35).
// Limiti dichiarati: colture irrigate dentro poligoni combustibili verrebbero lette come macchia;
// immagini non estive non separano le due classi (la soglia di Otsu lo segnala con una separazione bassa).

const HERB = [1, 2, 3], SHRUB = [4, 5, 6, 7], LITTER = [8, 9, 10];

/**
 * Soglia di Otsu su valori in [lo, hi] con `bins` classi: massimizza la varianza tra i due gruppi.
 * @returns { t, separation }  separation = varianza tra i gruppi / varianza totale (0 … 1)
 */
export function otsu(values, { lo = -0.2, hi = 1, bins = 240 } = {}) {
  const h = new Float64Array(bins);
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    h[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
    n++;
  }
  const x = (k) => lo + ((k + 0.5) * (hi - lo)) / bins;
  let sum = 0, sum2 = 0;
  for (let k = 0; k < bins; k++) { sum += h[k] * x(k); sum2 += h[k] * x(k) ** 2; }
  const total = sum2 / n - (sum / n) ** 2;
  // a parità di varianza (classi vuote tra i due gruppi) si prende il centro dell'intervallo di soglie migliori
  let w0 = 0, s0 = 0, best = -1, k0 = 0, k1 = 0;
  for (let k = 0; k < bins - 1; k++) {
    w0 += h[k]; s0 += h[k] * x(k);
    const w1 = n - w0;
    if (!w0 || !w1) continue;
    const between = (w0 * w1 * (s0 / w0 - (sum - s0) / w1) ** 2) / (n * n);
    if (between > best * (1 + 1e-9)) { best = between; k0 = k1 = k; }
    else if (between >= best * (1 - 1e-9)) k1 = k;
  }
  return { t: lo + (((k0 + k1) / 2 + 1) * (hi - lo)) / bins, separation: total > 0 ? best / total : 0 };
}

/**
 * Griglia con il combustibile corretto dall'NDVI (in cache). Senza NDVI la griglia resta uguale.
 * @returns griglia con `fuel` corretto e `fuelNdvi` = { threshold, separation, changed: { herbToShrub, shrubToHerb, litterToGrass } }
 */
export function withNdviFuel(grid) {
  if (grid._ndviFuel) return grid._ndviFuel;
  let out = grid;
  if (grid.ndvi) {
    const vals = [];
    for (let i = 0; i < grid.n; i++) if (grid.fuel[i] > 0 && Number.isFinite(grid.ndvi[i])) vals.push(grid.ndvi[i]);
    if (vals.length) {
      const { t, separation } = otsu(vals);
      const fuel = Uint8Array.from(grid.fuel);
      const changed = { herbToShrub: 0, shrubToHerb: 0, litterToGrass: 0 };
      for (let i = 0; i < grid.n; i++) {
        const k = fuel[i], v = grid.ndvi[i];
        if (!k || !Number.isFinite(v)) continue;
        if (HERB.includes(k) && v > t) { fuel[i] = 4; changed.herbToShrub++; }
        else if (SHRUB.includes(k) && v < t) { fuel[i] = 1; changed.shrubToHerb++; }
        else if (LITTER.includes(k) && v < t) { fuel[i] = 2; changed.litterToGrass++; }
      }
      // le varianti con le barriere in cache sulla griglia di partenza non valgono per il nuovo combustibile
      out = { ...grid, fuel, fuelNdvi: { threshold: t, separation, changed }, _barriersAbs: undefined, _barriersGap: undefined };
    }
  }
  Object.defineProperty(grid, '_ndviFuel', { value: out, enumerable: false });
  return out;
}
