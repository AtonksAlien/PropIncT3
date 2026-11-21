// Modelli di riferimento "ingenui", con la stessa area dell'incendio osservato.
//
// Un punteggio di somiglianza da solo non dice se il modello è buono: un perimetro qualsiasi della
// dimensione giusta centrato sull'innesco ottiene già un Sørensen discreto. Il modello vale qualcosa se
// batte questi riferimenti, che non sanno nulla di combustibile e terreno:
//  - cerchio centrato sull'innesco;
//  - ellisse di Anderson (1983) orientata con il vento medio, con l'innesco nel fuoco posteriore
//    (la forma di un incendio con vento su terreno piano e combustibile uniforme).
// L'area è la stessa delle celle osservate (K celle del dominio), quindi conta solo la forma.

import { lengthToWidth, eccentricity } from '../../engine/ellipse.js';

// Vento a mezza fiamma ≈ 0,4 × vento a 10 m in terreno aperto (Albini & Baughman 1979, erba e arbusti bassi)
export const OPEN_WAF = 0.4;

/**
 * Ellisse con l'innesco nel fuoco posteriore, scalata finché contiene K celle del dominio.
 * Le ellissi con lo stesso fuoco e la stessa forma sono una dentro l'altra, quindi basta una bisezione.
 * @param ign    { r, c } cella di innesco
 * @param head   direzione verso cui soffia il vento (gradi da Nord)
 * @param lw     rapporto lunghezza/larghezza (1 = cerchio)
 */
export function ellipseMask(grid, domain, ign, K, head = 0, lw = 1) {
  const { rows, cols, res } = grid;
  const e = eccentricity(lw), th = (head * Math.PI) / 180;
  const ux = Math.sin(th), uy = Math.cos(th);           // asse maggiore in coordinate (est, nord)
  const x0 = (ign.c + 0.5) * res, y0 = -(ign.r + 0.5) * res;
  const inside = (a, i) => {
    const b = a / lw, r = (i / cols) | 0, c = i % cols;
    const dx = (c + 0.5) * res - (x0 + a * e * ux), dy = -(r + 0.5) * res - (y0 + a * e * uy);
    const p = dx * ux + dy * uy, q = -dx * uy + dy * ux;
    return (p / a) ** 2 + (q / b) ** 2 <= 1;
  };
  const count = (a) => { let k = 0; for (let i = 0; i < rows * cols; i++) if (domain[i] && inside(a, i)) k++; return k; };
  let lo = 0, hi = Math.hypot(rows, cols) * res * 2;
  if (count(hi) < K) lo = hi;                            // il dominio non basta: si prende tutto quello che c'è
  for (let it = 0; it < 40 && hi - lo > res / 20; it++) {
    const mid = (lo + hi) / 2;
    if (count(mid) >= K) hi = mid; else lo = mid;
  }
  const mask = new Uint8Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) if (domain[i] && inside(hi, i)) mask[i] = 1;
  return { mask, semiMajorM: hi, lw };
}

/**
 * Vento medio (media vettoriale) nelle prime `minutes` della simulazione, campionato ogni 10 minuti.
 * @returns { speed (m/s), from, head (verso cui soffia), lw dell'ellisse di Anderson }
 */
export function meanWind(weather, minutes) {
  let sx = 0, sy = 0, sp = 0, k = 0;
  for (let m = 0; m <= Math.max(minutes, 0); m += 10) {
    const { ws10, from } = weather.at(m);
    const to = ((from + 180) * Math.PI) / 180;
    sx += ws10 * Math.sin(to); sy += ws10 * Math.cos(to); sp += ws10; k++;
  }
  const head = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
  const speed = sp / k;
  const lw = lengthToWidth(speed * OPEN_WAF * 60);
  return { speed, head, from: (head + 180) % 360, lw };
}
