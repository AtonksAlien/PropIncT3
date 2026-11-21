// Colori e disegno delle griglie in ImageData (RGBA). Una passata su 360 000 celle richiede pochi ms:
// si può ridisegnare a ogni fotogramma della riproduzione.

export const FRONT_MIN = 10;   // celle accese da meno di 10 minuti: "fronte attivo"

// Isocrone: dal giallo (prima ora) al viola scuro (ultime ore).
const RAMP = [[255, 237, 100], [253, 174, 60], [240, 101, 37], [200, 40, 40], [140, 10, 70], [70, 0, 70]];
export function rampColor(x) {
  const t = Math.min(Math.max(x, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(t), RAMP.length - 2), f = t - k;
  return RAMP[k].map((v, j) => Math.round(v + (RAMP[k + 1][j] - v) * f));
}

/** Banda delle isocrone: 1 ora fino a 6 ore di simulazione, poi 2 ore. */
export const bandMinutes = (maxMin) => (maxMin <= 360 ? 60 : 120);

export function isochroneLegend(maxMin) {
  const band = bandMinutes(maxMin), n = Math.ceil(maxMin / band);
  return Array.from({ length: n }, (_, k) => ({
    label: `${(k * band) / 60}–${((k + 1) * band) / 60} h`,
    color: `rgb(${rampColor(n === 1 ? 0 : k / (n - 1)).join(',')})`,
  }));
}

/**
 * Area bruciata fino al minuto t: isocrone a bande, fronte attivo in giallo chiaro, il resto trasparente.
 * @returns numero di celle bruciate entro t
 */
export function paintArrival(img, arrival, t, maxMin) {
  const band = bandMinutes(maxMin), n = Math.ceil(maxMin / band);
  const lut = Array.from({ length: n }, (_, k) => rampColor(n === 1 ? 0 : k / (n - 1)));
  const px = new Uint32Array(img.data.buffer);
  const pack = (r, g, b, a) => (a << 24) | (b << 16) | (g << 8) | r;   // little-endian RGBA
  const front = pack(255, 255, 210, 255);
  const colors = lut.map(([r, g, b]) => pack(r, g, b, 215));
  let burned = 0;
  for (let i = 0; i < arrival.length; i++) {
    const a = arrival[i];
    if (!(a <= t)) { px[i] = 0; continue; }
    burned++;
    px[i] = t - a < FRONT_MIN ? front : colors[Math.min(Math.floor(a / band), n - 1)];
  }
  return burned;
}

// Combustibile (Anderson 13): colori tenui, fanno da sfondo.
export const FUEL_STYLE = {
  0: { name: 'Non combustibile', rgb: [150, 150, 150] },
  1: { name: '1 · Erba bassa (seminativi, prati)', rgb: [230, 215, 120] },
  2: { name: '2 · Erba sotto copertura rada', rgb: [200, 190, 90] },
  3: { name: '3 · Erba alta', rgb: [220, 190, 60] },
  4: { name: '4 · Macchia alta e densa', rgb: [140, 120, 60] },
  5: { name: '5 · Arbusti bassi', rgb: [185, 170, 110] },
  6: { name: '6 · Arbusti', rgb: [170, 160, 90] },
  8: { name: '8 · Lettiera compatta', rgb: [110, 160, 110] },
  9: { name: '9 · Lettiera di latifoglie', rgb: [90, 160, 90] },
  10: { name: '10 · Pineta con sottobosco', rgb: [40, 120, 70] },
};

export function paintFuel(img, fuel) {
  const px = new Uint32Array(img.data.buffer);
  const lut = new Uint32Array(256);
  for (const [k, { rgb: [r, g, b] }] of Object.entries(FUEL_STYLE)) lut[k] = (150 << 24) | (b << 16) | (g << 8) | r;
  for (let i = 0; i < fuel.length; i++) px[i] = lut[fuel[i]];
  return img;
}

// Barriere da OpenStreetMap (pipeline/barriers.js, DECISIONI D46 e D49). Strade asfaltate, ferrovie e
// acqua (classi 1, 3, 4) sono fasce senza combustibile con una larghezza: il fronte le supera se la
// larghezza è minore di 2 volte la lunghezza di fiamma (+4 m con vento oltre 5 m/s). Sulla mappa si
// colorano per facilità di attraversamento; piste e sentieri (classe 2) non fermano il fuoco.
export const BLOCKING = [1, 3, 4];
export const BARRIER_TYPE = { 1: 'Strada asfaltata', 2: 'Pista o sentiero', 3: 'Ferrovia', 4: 'Acqua' };
export const IMPASSABLE_WIDTH = 255;
export const CROSSING_STYLE = {
  track: { name: 'Pista o sentiero: non ferma il fuoco', rgb: [150, 105, 60] },
  easy: { name: 'Attraversabile facilmente (fino a 7 m: fiamma ≥ 3,5 m)', rgb: [245, 190, 70] },
  medium: { name: 'Attraversabile con fiamme alte (8–15 m: fiamma ≥ 4–7,5 m)', rgb: [230, 110, 30] },
  hard: { name: 'Solo con fiamme molto alte (oltre 15 m, es. superstrade)', rgb: [160, 25, 25] },
  never: { name: 'Invalicabile (laghi e invasi)', rgb: [25, 50, 140] },
  wall: { name: 'Barriera (con le barriere assolute ferma sempre il fuoco)', rgb: [55, 55, 55] },
};

/** Classe di facilità di attraversamento della cella (chiave di CROSSING_STYLE) o null. */
export function crossingClass(type, width) {
  if (!type) return null;
  if (type === 2) return 'track';
  if (width === undefined || width === null) return 'wall';   // pacchetto senza larghezze
  if (width >= IMPASSABLE_WIDTH) return 'never';
  return width <= 7 ? 'easy' : width <= 15 ? 'medium' : 'hard';
}

/** Testo per la lettura della cella: tipo, larghezza e fiamma necessaria per superarla. */
export function barrierText(type, width, mode) {
  const name = BARRIER_TYPE[type] ?? 'Barriera';
  if (type === 2) return `${name} (non ferma il fuoco)`;
  if (mode === false) return `${name} (barriere spente)`;
  if (mode === 'assolute' || width === undefined || width === null) return `${name} (ferma il fuoco)`;
  if (width >= IMPASSABLE_WIDTH) return `${name}: invalicabile`;
  const f = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 1 });
  return `${name} larga ${width} m: il fuoco la supera con fiamme di almeno ${f(width / 2)} m (${f(Math.max(0, (width - 4) / 2))} m con vento oltre 5 m/s)`;
}

export function paintBarriers(img, layer, width = null, mode = true) {
  const px = new Uint32Array(img.data.buffer);
  const col = (k, a = 255) => { const [r, g, b] = CROSSING_STYLE[k].rgb; return (a << 24) | (b << 16) | (g << 8) | r; };
  for (let i = 0; i < layer.length; i++) {
    const t = layer[i];
    if (!t) { px[i] = 0; continue; }
    const k = t !== 2 && (mode === 'assolute' || !width) ? 'wall' : crossingClass(t, width ? width[i] : null);
    px[i] = col(k, t === 2 ? 150 : mode === false ? 110 : 255);
  }
  return img;
}
