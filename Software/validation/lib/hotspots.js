// Punti caldi satellitari NASA FIRMS (VIIRS 375 m, MODIS 1 km) per controllare i tempi della simulazione.
//
// Un punto caldo dice: "all'ora del passaggio del satellite, in questo pixel c'era fuoco attivo". Quindi
// il fronte simulato deve essere già arrivato in quel pixel a quell'ora. Se arriva dopo, il modello è
// troppo lento (o l'innesco è sbagliato); se arriva molto prima non è necessariamente un errore, perché
// un'area può continuare a bruciare per ore. Per questo si contano soprattutto i casi "in ritardo".
//
// Formato: CSV di FIRMS (archivio o tempo quasi reale), colonne latitude, longitude, acq_date (AAAA-MM-GG),
// acq_time (HHMM in UTC), scan e track (dimensione del pixel in km), satellite, instrument, confidence.

import { latLonToCell } from '../../engine/grid.js';

/** Cella del punto, oppure null se cade fuori dalla griglia. */
export function cellOf(grid, lat, lon) {
  const p = latLonToCell(grid, lat, lon);
  return p.r >= 0 && p.c >= 0 && p.r < grid.rows && p.c < grid.cols ? p : null;
}

/** Legge il CSV di FIRMS. @returns [{ lat, lon, time (Date UTC), sizeKm, satellite, instrument, confidence }] */
export function parseFirms(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const need = ['latitude', 'longitude', 'acq_date', 'acq_time'];
  for (const n of need) if (col(n) < 0) throw new Error(`CSV FIRMS senza la colonna "${n}" (trovate: ${head.join(', ')})`);
  return lines.slice(1).map((l) => {
    const v = l.split(',');
    const hhmm = v[col('acq_time')].trim().replace(':', '').padStart(4, '0');
    const [y, mo, d] = v[col('acq_date')].trim().split('-').map(Number);
    const instrument = col('instrument') >= 0 ? v[col('instrument')].trim() : '';
    const scan = col('scan') >= 0 ? Number(v[col('scan')]) : NaN, track = col('track') >= 0 ? Number(v[col('track')]) : NaN;
    const nominal = /MODIS/i.test(instrument) ? 1 : 0.375;
    return {
      lat: Number(v[col('latitude')]), lon: Number(v[col('longitude')]),
      time: new Date(Date.UTC(y, mo - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(2)))),
      sizeKm: Number.isFinite(scan) && Number.isFinite(track) ? Math.max(scan, track) : nominal,
      satellite: col('satellite') >= 0 ? v[col('satellite')].trim() : '',
      instrument,
      confidence: col('confidence') >= 0 ? v[col('confidence')].trim() : '',
    };
  });
}

/**
 * Confronto tra punti caldi e tempo di arrivo simulato.
 * Per ogni punto: primo arrivo simulato dentro il pixel (quadrato di lato sizeKm centrato sul punto).
 * @param startMs  istante dell'innesco (ms UTC)
 * @param tolMin   tolleranza: "in ritardo" solo se il fronte arriva più di tolMin minuti dopo il passaggio
 * @returns { points: [...], summary }
 */
export function hotspotTiming(grid, arrival, hotspots, startMs, maxMin, { tolMin = 60 } = {}) {
  const { rows, cols, res } = grid;
  const points = [];
  for (const h of hotspots) {
    const cell = cellOf(grid, h.lat, h.lon);
    const tObs = (h.time.getTime() - startMs) / 60000;
    const p = { ...h, time: h.time.toISOString(), r: cell?.r ?? null, c: cell?.c ?? null, tObsMin: tObs, simFirstMin: null, errMin: null };
    if (!cell) { p.status = 'fuori zona'; points.push(p); continue; }
    if (tObs < 0) { p.status = "prima dell'innesco"; points.push(p); continue; }
    if (tObs > maxMin) { p.status = 'dopo la fine simulata'; points.push(p); continue; }
    const half = Math.max(1, Math.round((h.sizeKm * 1000) / 2 / res));
    let first = Infinity;
    for (let r = Math.max(0, cell.r - half); r <= Math.min(rows - 1, cell.r + half); r++) {
      for (let c = Math.max(0, cell.c - half); c <= Math.min(cols - 1, cell.c + half); c++) first = Math.min(first, arrival[r * cols + c]);
    }
    p.simFirstMin = Number.isFinite(first) ? first : null;
    p.errMin = Number.isFinite(first) ? first - tObs : null;
    p.status = !Number.isFinite(first) ? 'non raggiunto' : first - tObs > tolMin ? 'in ritardo' : 'coerente';
    points.push(p);
  }
  const used = points.filter((p) => ['coerente', 'in ritardo', 'non raggiunto'].includes(p.status));
  const n = used.length, pct = (s) => (n ? used.filter((p) => p.status === s).length / n : null);
  const errs = used.filter((p) => p.errMin !== null).map((p) => p.errMin).sort((a, b) => a - b);
  return {
    points,
    summary: {
      total: hotspots.length, used: n, tolMin,
      consistent: pct('coerente'), late: pct('in ritardo'), notReached: pct('non raggiunto'),
      medianErrMin: errs.length ? errs[errs.length >> 1] : null,
      beforeIgnition: points.filter((p) => p.status === "prima dell'innesco").length,
      outside: points.filter((p) => p.status === 'fuori zona').length,
    },
  };
}

/** Primo passaggio con punti caldi dentro la zona: un aiuto per scegliere ora e punto di innesco. */
export function firstDetection(grid, hotspots) {
  const inside = hotspots.filter((h) => cellOf(grid, h.lat, h.lon));
  if (!inside.length) return null;
  const t0 = Math.min(...inside.map((h) => h.time.getTime()));
  const first = inside.filter((h) => h.time.getTime() === t0);
  return {
    time: new Date(t0).toISOString(), count: first.length,
    lat: first.reduce((s, h) => s + h.lat, 0) / first.length, lon: first.reduce((s, h) => s + h.lon, 0) / first.length,
  };
}
