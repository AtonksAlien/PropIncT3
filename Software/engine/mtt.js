// Modello C — tempo minimo di arrivo (Minimum Travel Time) con l'algoritmo di Dijkstra.
//
// Idea (Finney 2002, alla base di FlamMap): il fuoco raggiunge ogni cella per il percorso più veloce.
// La griglia è un grafo: ogni cella è collegata a 16 vicine (8 adiacenti + 8 "a salto di cavallo").
// Il tempo per passare dalla cella i alla vicina j, distanti d lungo l'azimut θ, è
//     t = (d/2) / R_i(θ) + (d/2) / R_j(θ)
// dove R(θ) è la velocità nella direzione θ data dall'ellisse di ogni cella (Rothermel + Anderson).
// Dijkstra estrae sempre la cella con il tempo più piccolo: quando una cella esce dalla coda, il suo
// tempo è definitivo. Non c'è un passo di tempo: il risultato non dipende da un passo `dt`.
//
// Perché 16 direzioni: con 8 il fronte è un ottagono (errore fino a 1/cos 22,5° − 1 = 8,2% sulle distanze);
// con 16 le direzioni distano al più 26,6° e l'errore massimo è 1/cos 13,3° − 1 = 2,7% (verificato nei test).
// Meteo variabile: le velocità si prendono dal campo dell'istante in cui la cella di partenza si accende.
//
// Barriere attraversabili (DECISIONI D46). Le celle di strada, ferrovia o acqua sono senza combustibile,
// ma ognuna ha una larghezza di fascia vuota (`grid.gapWidth`, metri; Infinity = invalicabile). Da una
// cella in fiamme il fronte può saltare in linea retta fino a MAX_JUMP celle di barriera e accendere la
// prima cella combustibile oltre, se la fascia è più stretta della distanza che la fiamma copre:
//     larghezza < 2 · L_f  (+ 4 m se il vento a 10 m supera 5 m/s)
// con L_f lunghezza di fiamma di Byram dall'intensità del fronte nella direzione del salto. Regola
// "larghezza = 2 × lunghezza di fiamma" per fermare un fronte (Brou 2022); oltre 5 m/s di vento serve
// un margine di 4 m (Brou et al. 2025). Così il fronte di testa supera una strada stretta e i fianchi no.
// La lunghezza di fiamma si calcola con il vento di raffica (l'attraversamento avviene nei picchi; il
// simulatore Spark ottiene attraversamenti più realistici includendo le fluttuazioni del vento), mentre
// la velocità di propagazione resta quella del vento medio.

import { MinHeap } from './heap.js';
import { flameLength } from './spreadfield.js';

// 8 adiacenti + 8 a salto di cavallo, con le celle attraversate dal segmento (per non scavalcare barriere).
const STENCIL = [];
for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]]) {
  let via = [];
  if (Math.abs(dr) === 1 && Math.abs(dc) === 1) via = [[dr, 0], [0, dc]];
  else if (Math.abs(dr) === 2) via = [[dr / 2, 0], [dr / 2, dc]];
  else if (Math.abs(dc) === 2) via = [[0, dc / 2], [dr, dc / 2]];
  STENCIL.push({ dr, dc, via, len: Math.hypot(dr, dc), az: ((Math.atan2(dc, -dr) * 180) / Math.PI + 360) % 360 });
}

const RAD = Math.PI / 180;
const MAX_JUMP = 3;            // celle di barriera attraversabili in un salto (una strada rasterizzata ne occupa 1–2)
const WIND_MARGIN_MS = 5;      // oltre questo vento a 10 m la soglia cresce di WIND_MARGIN_M (Brou et al. 2025)
const WIND_MARGIN_M = 4;

/** Larghezza massima di fascia senza combustibile che il fronte supera, in metri. */
export function crossableWidth(flameLengthM, ws10) {
  return 2 * flameLengthM + (ws10 > WIND_MARGIN_MS ? WIND_MARGIN_M : 0);
}

/**
 * @param grid       { rows, cols, res, n }
 * @param ignitions  array di { r, c }
 * @param fieldAt    funzione (minuto) → { ros (m/min), dir (gradi), ecc } per cella; ros = 0 → non brucia
 * @param opts.maxMin durata massima (default 240)
 * @returns { arrival (Float32Array, minuti; Infinity = non raggiunta), burnedCells, burnedHa, ms, pops, crossings }
 *           crossings = salti di barriera riusciti (celle accese oltre una strada o un corso d'acqua)
 */
export function runMTT(grid, ignitions, fieldAt, { maxMin = 240 } = {}) {
  const { rows, cols, res, n } = grid;
  const t0 = performance.now();
  // Tempi a 64 bit durante il calcolo (come le chiavi della coda): a 32 bit l'arrotondamento farebbe
  // sembrare "superata" ogni copia estratta. Si converte in Float32Array solo alla fine.
  const time = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const heap = new MinHeap(1 << 16);

  let f0 = fieldAt(0);
  for (const { r, c } of ignitions) {
    const i = r * cols + c;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    f0.ensure?.(i);
    if (!(f0.ros[i] > 0)) continue;
    time[i] = 0; heap.push(0, i);
  }

  const rate = (f, i, az) => {            // velocità in cella i lungo l'azimut az (ellisse dal fuoco)
    const e = f.ecc[i];
    return (f.ros[i] * (1 - e)) / (1 - e * Math.cos((az - f.dir[i]) * RAD));
  };

  const gap = grid.gapWidth ?? null;   // presente solo sulla griglia con le barriere attraversabili
  let burned = 0, pops = 0, crossings = 0;
  while (heap.size > 0) {
    const i = heap.pop();
    const t = heap.lastKey;
    if (done[i] || t > time[i]) continue;   // copia superata
    if (t > maxMin) break;
    done[i] = 1; burned++; pops++;
    const f = fieldAt(t);
    // campo su richiesta (LazyField): ogni cella si calcola la prima volta che serve in questo istante
    const lazy = typeof f.ensure === 'function';
    if (lazy) f.ensure(i);
    if (!(f.ros[i] > 0)) continue;
    const r = (i / cols) | 0, c = i - r * cols;
    for (const s of STENCIL) {
      const rr = r + s.dr, cc = c + s.dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const j = rr * cols + cc;
      if (done[j]) continue;
      if (lazy) f.ensure(j);
      if (!(f.ros[j] > 0)) continue;
      let blocked = false;
      for (const [vr, vc] of s.via) {
        const v = (r + vr) * cols + c + vc;
        if (lazy) f.ensure(v);
        if (!(f.ros[v] > 0)) { blocked = true; break; }
      }
      if (blocked) continue;
      const half = (s.len * res) / 2;
      const tj = t + half / rate(f, i, s.az) + half / rate(f, j, s.az);
      if (tj < time[j]) { time[j] = tj; heap.push(tj, j); }
    }
    if (gap && typeof f.heatPerArea === 'function') crossings += jump(f, i, r, c, t, lazy);
  }

  // Salto delle barriere nelle 8 direzioni adiacenti (vedi l'intestazione).
  function jump(f, i, r, c, t, lazy) {
    const ha = f.heatPerArea(i);
    if (!(ha > 0)) return 0;
    let made = 0;
    for (let d = 0; d < 8; d++) {
      const s = STENCIL[d];
      let wmax = 0, k = 1, j = -1;
      for (; k <= MAX_JUMP + 1; k++) {
        const rr = r + k * s.dr, cc = c + k * s.dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) break;
        const v = rr * cols + cc;
        if (Number.isFinite(gap[v])) { if (k > MAX_JUMP) break; wmax = Math.max(wmax, gap[v]); continue; }
        if (k >= 2) j = v;   // prima cella che non è barriera, dopo almeno una barriera
        break;
      }
      if (j < 0 || done[j]) continue;
      if (lazy) f.ensure(j);
      if (!(f.ros[j] > 0)) continue;
      const rI = rate(f, i, s.az);
      // intensità di Byram (kW/m) = H_A (kJ/m²) · R (m/s); con la raffica se il campo la fornisce
      const lf = typeof f.gustFlame === 'function' ? f.gustFlame(i, s.az) : flameLength((ha * rI) / 60);
      if (wmax >= crossableWidth(lf, f.gust ?? f.ws10 ?? 0)) continue;
      const half = (s.len * res) / 2, dist = k * s.len * res;
      const tj = t + (dist - half) / rI + half / rate(f, j, s.az);
      if (tj < time[j]) { time[j] = tj; heap.push(tj, j); made++; }
    }
    return made;
  }
  // Celle con tempo oltre la durata: non raggiunte entro maxMin.
  const arrival = new Float32Array(n);
  for (let i = 0; i < n; i++) arrival[i] = time[i] > maxMin ? Infinity : time[i];
  return { arrival, burnedCells: burned, burnedHa: (burned * res * res) / 1e4, ms: performance.now() - t0, pops, crossings };
}

/** Campo costante: per i test e per meteo fisso. */
export const constantField = (field) => () => field;
