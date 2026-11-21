// Meteo nel motore: serie oraria → valori al minuto, umidità del combustibile morto.
// Puro JavaScript (Node e browser). Il download e la cache sono in backend/src/weather/openmeteo.js.


const RAD = Math.PI / 180;

/** Risposta JSON di Open-Meteo (timeformat=unixtime, wind_speed_unit=ms) → serie in TypedArray. */
export function parseHourly(json) {
  const h = json.hourly;
  const f32 = (k) => Float32Array.from(h[k], (v) => (v === null ? NaN : v));
  const s = {
    t: Float64Array.from(h.time),                 // secondi Unix, UTC
    temp: f32('temperature_2m'),                  // °C
    rh: f32('relative_humidity_2m'),              // %
    ws: f32('wind_speed_10m'),                    // m/s
    wd: f32('wind_direction_10m'),                // gradi, da dove proviene
    gust: f32('wind_gusts_10m'),                  // m/s
    precip: f32('precipitation'),                 // mm nell'ora precedente
  };
  s.n = s.t.length;
  return s;
}

/** Indice k e peso f tali che t sta tra s.t[k] e s.t[k+1] (fuori dai limiti: valore all'estremo). */
function locate(s, tSec) {
  if (tSec <= s.t[0]) return [0, 0];
  if (tSec >= s.t[s.n - 1]) return [s.n - 2, 1];
  let lo = 0, hi = s.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.t[m] <= tSec) lo = m; else hi = m; }
  return [lo, (tSec - s.t[lo]) / (s.t[lo + 1] - s.t[lo])];
}

const lerp = (a, k, f) => a[k] + (a[k + 1] - a[k]) * f;

/**
 * Meteo all'istante tSec, interpolato linearmente tra le due ore vicine.
 * La direzione del vento si interpola sul vettore (seno e coseno), non sull'angolo:
 * tra 350° e 10° la media corretta è 0°, non 180°. La velocità si interpola a parte,
 * perché la media dei vettori la ridurrebbe artificialmente quando la direzione ruota.
 */
export function weatherAt(s, tSec) {
  const [k, f] = locate(s, tSec);
  const a0 = s.wd[k] * RAD, a1 = s.wd[k + 1] * RAD;
  const x = Math.sin(a0) * (1 - f) + Math.sin(a1) * f;
  const y = Math.cos(a0) * (1 - f) + Math.cos(a1) * f;
  return {
    temp: lerp(s.temp, k, f), rh: lerp(s.rh, k, f),
    windSpeed: lerp(s.ws, k, f), windFrom: ((Math.atan2(x, y) / RAD) + 360) % 360,
    gust: lerp(s.gust, k, f),
  };
}

/**
 * Umidità di equilibrio del legno morto (EMC, frazione), Simard (1968), usata dal NFDRS (Bradshaw et al. 1984).
 * tempC in °C, rh in %.
 */
export function emcSimard(tempC, rh) {
  const T = tempC * 9 / 5 + 32;   // la formula originale è in °F
  const H = Math.min(Math.max(rh, 0), 100);
  let emc;
  if (H < 10) emc = 0.03229 + 0.281073 * H - 0.000578 * H * T;
  else if (H < 50) emc = 2.22749 + 0.160107 * H - 0.01478 * T;
  else emc = 21.0606 + 0.005565 * H * H - 0.00035 * H * T - 0.483199 * H;
  return Math.max(emc, 0.5) / 100;
}

export const TIMELAG_H = { m1: 1, m10: 10, m100: 100 };
export const RAIN_MM = 0.5;          // ora "piovosa" se la pioggia supera questa soglia
export const RAIN_TARGET = 0.35;     // umidità verso cui tende il combustibile sotto la pioggia (circa saturazione)

/**
 * Umidità del combustibile morto 1h, 10h, 100h, ora per ora, con il modello a tempo di ritardo
 * (Byram 1963; Fosberg 1970): ogni classe tende all'EMC con costante di tempo τ = 1, 10, 100 ore,
 *   m(t+Δt) = EMC + (m(t) − EMC) · exp(−Δt/τ).
 * Si parte in equilibrio con la prima ora: per questo la serie va chiesta con qualche giorno di anticipo
 * (3 giorni bastano per 1h e 10h; 100h conserva in parte la condizione iniziale — limite dichiarato).
 * @returns {{m1: Float32Array, m10: Float32Array, m100: Float32Array, emc: Float32Array}} frazioni (0,08 = 8%)
 */
export function deadFuelMoisture(s) {
  const out = { emc: new Float32Array(s.n) };
  for (const k of Object.keys(TIMELAG_H)) out[k] = new Float32Array(s.n);
  for (let i = 0; i < s.n; i++) {
    const emc = emcSimard(s.temp[i], s.rh[i]);
    const target = s.precip[i] >= RAIN_MM ? RAIN_TARGET : emc;
    out.emc[i] = emc;
    for (const [k, tau] of Object.entries(TIMELAG_H)) {
      if (i === 0) { out[k][0] = target; continue; }
      const dtH = (s.t[i] - s.t[i - 1]) / 3600;
      out[k][i] = target + (out[k][i - 1] - target) * Math.exp(-dtH / tau);
    }
  }
  return out;
}

/** Umidità morta all'istante tSec (interpolata tra le ore). */
export function moistureAt(s, moist, tSec) {
  const [k, f] = locate(s, tSec);
  return { m1: lerp(moist.m1, k, f), m10: lerp(moist.m10, k, f), m100: lerp(moist.m100, k, f) };
}

/**
 * Umidità del combustibile vivo: scenari di Scott & Burgan (2005), Tabella 6.
 * L1 = erbacee del tutto secche (30% erba, 60% legnoso) … L4 = verdi (120%, 150%).
 * Scelta per mese (assunzione nostra, da dichiarare): lug–set L1, giu e ott L2, altrimenti L3.
 */
export const LIVE_SCENARIOS = {
  L1: { herb: 0.30, woody: 0.60 }, L2: { herb: 0.60, woody: 0.90 },
  L3: { herb: 0.90, woody: 1.20 }, L4: { herb: 1.20, woody: 1.50 },
};
export function liveScenarioFor(date) {
  const m = date.getUTCMonth() + 1;
  return m >= 7 && m <= 9 ? 'L1' : m === 6 || m === 10 ? 'L2' : 'L3';
}
