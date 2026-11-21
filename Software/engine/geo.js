// Proiezione UTM su ellissoide WGS84 (serie di Krüger, precisione sotto il millimetro nel fuso).
// Serve per gli inneschi cliccati sulla mappa (lat/lon) e per disegnare la griglia UTM su Leaflet.
// A Mercadante (16,7° E, meridiano centrale 15° E) il reticolo UTM è ruotato di circa 1,1° rispetto ai
// meridiani: una conversione lineare tra i confini sbaglierebbe fino a circa 60 m ai bordi della zona.
// Formule: Karney (2011), "Transverse Mercator with an accuracy of a few nanometers", J. Geodesy 85.

const A_WGS = 6378137, F_WGS = 1 / 298.257223563, K0 = 0.9996, E0 = 500000;
const n = F_WGS / (2 - F_WGS), n2 = n * n, n3 = n2 * n;
const A = (A_WGS / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
const ALPHA = [n / 2 - (2 / 3) * n2 + (5 / 16) * n3, (13 / 48) * n2 - (3 / 5) * n3, (61 / 240) * n3];
const BETA = [n / 2 - (2 / 3) * n2 + (37 / 96) * n3, (1 / 48) * n2 + (1 / 15) * n3, (17 / 480) * n3];
const DELTA = [2 * n - (2 / 3) * n2 - 2 * n3, (7 / 3) * n2 - (8 / 5) * n3, (56 / 15) * n3];
const C = (2 * Math.sqrt(n)) / (1 + n);
const RAD = Math.PI / 180;

const centralMeridian = (zone) => (zone * 6 - 183) * RAD;

/** (lat, lon) in gradi → { x: Est, y: Nord } in metri, emisfero Nord. */
export function latLonToUtm(lat, lon, zone = 33) {
  const phi = lat * RAD, dl = lon * RAD - centralMeridian(zone);
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - C * Math.atanh(C * s));
  const xi = Math.atan(t / Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  for (let j = 1; j <= 3; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { x: E0 + K0 * A * x, y: K0 * A * y };
}

/** { Est, Nord } in metri → { lat, lon } in gradi, emisfero Nord. */
export function utmToLatLon(x, y, zone = 33) {
  const xi = y / (K0 * A), eta = (x - E0) / (K0 * A);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 3; j++) {
    xp -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  return { lat: phi / RAD, lon: (centralMeridian(zone) + Math.atan(Math.sinh(ep) / Math.cos(xp))) / RAD };
}

/** Fuso UTM da un codice EPSG 326xx (emisfero Nord). */
export function utmZoneOf(crs) {
  const m = /^EPSG:326(\d\d)$/.exec(crs);
  if (!m) throw new Error(`Sistema di riferimento non UTM Nord: ${crs}`);
  return Number(m[1]);
}
