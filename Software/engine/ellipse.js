// Forma del fuoco: ellisse di Anderson (1983), come in Behave/BehavePlus.
//
// Un incendio puntiforme con vento cresce come un'ellisse con l'innesco in un fuoco (Van Wagner 1969).
// La forma dipende dal vento efficace U (mi/h) tramite il rapporto lunghezza/larghezza:
//   LW = 0,936·e^(0,1147·U) + 0,461·e^(−0,0692·U) − 0,397        (massimo 8)
//   e  = √(LW² − 1) / LW                                         (eccentricità)
// Velocità dal punto di innesco in una direzione che forma l'angolo β con quella di massima:
//   R(β) = R_max · (1 − e) / (1 − e·cos β)
// Con β = 0 si ottiene R_max (testa), con β = 180° R_max·(1−e)/(1+e) (coda).

const MMIN_PER_MPH = 1609.344 / 60;   // 1 mi/h = 26,82 m/min

/** Rapporto lunghezza/larghezza dal vento efficace in m/min. */
export function lengthToWidth(effWindMMin) {
  const U = effWindMMin / MMIN_PER_MPH;
  if (U <= 1e-7) return 1;
  return Math.min(0.936 * Math.exp(0.1147 * U) + 0.461 * Math.exp(-0.0692 * U) - 0.397, 8);
}

export function eccentricity(lw) {
  const x = lw * lw - 1;
  return x > 0 ? Math.sqrt(x) / lw : 0;
}

/** Velocità nella direzione `azimuth` (gradi) per un'ellisse con testa verso `headDir`. */
export function rosAt(rMax, ecc, headDir, azimuth) {
  const beta = ((azimuth - headDir) * Math.PI) / 180;
  return (rMax * (1 - ecc)) / (1 - ecc * Math.cos(beta));
}

export const backingRos = (rMax, ecc) => (rMax * (1 - ecc)) / (1 + ecc);
