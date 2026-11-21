// Scelta della fonte Open-Meteo, URL della richiesta e controllo della serie oraria.
// Modulo puro, usato sia dal server (backend/src/weather/openmeteo.js) sia dal browser: il meteo per
// una simulazione lo scarica di norma il browser di chi la chiede, così ogni visitatore usa la quota
// gratuita di Open-Meteo del proprio indirizzo IP invece di quella, condivisa, del server.
//
//  - passato oltre 7 giorni → Historical API, ECMWF IFS (9 km, dal 2017; ERA5 25 km prima)
//  - ultimi giorni e prossimi 2 → Forecast API, ICON-2I di Italia Meteo ARPAE (2,2 km)
// Tutto in UTC (timezone=GMT, tempi in secondi Unix) e vento in m/s.

export const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'precipitation'];
const DAY = 86400e3;

/** Decide endpoint e modello. start/end: 'YYYY-MM-DD'. */
export function chooseSource(start, end, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (endMs <= today - 7 * DAY) {
    const model = Date.parse(`${start}T00:00:00Z`) >= Date.UTC(2017, 0, 1) ? 'ecmwf_ifs' : 'era5';
    return { kind: 'archivio', base: 'https://archive-api.open-meteo.com/v1/archive', model };
  }
  if (endMs > today + 2 * DAY) throw new Error('ICON-2I prevede al massimo 3 giorni: scegliere una data più vicina');
  return { kind: 'previsione', base: 'https://api.open-meteo.com/v1/forecast', model: 'italia_meteo_arpae_icon_2i' };
}

export function buildUrl({ lat, lon }, start, end, src) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: start, end_date: end,
    hourly: HOURLY.join(','), models: src.model,
    wind_speed_unit: 'ms', timezone: 'GMT', timeformat: 'unixtime',
  });
  return `${src.base}?${q}`;
}

/**
 * Giorni da chiedere per una simulazione che parte a `start` (Date) e dura `durMin` minuti: anche i 3 giorni
 * precedenti, che portano in equilibrio l'umidità del combustibile morto (engine/weather.js).
 */
export function simulationDays(start, durMin) {
  if (Number.isNaN(start.getTime())) throw new Error('Data di innesco non valida');
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { start: day(start.getTime() - 3 * DAY), end: day(start.getTime() + durMin * 60e3) };
}

/** Fonte e URL per una simulazione. @returns { kind, model, url, start, end } */
export function simulationRequest(point, start, durMin, now = new Date()) {
  const d = simulationDays(start, durMin);
  const src = chooseSource(d.start, d.end, now);
  return { kind: src.kind, model: src.model, url: buildUrl(point, d.start, d.end, src), ...d };
}

/**
 * Controlla una risposta di Open-Meteo (o una serie ricevuta da un client): struttura, lunghezze, valori
 * numerici e, se si passano start e durMin, copertura dell'intervallo della simulazione.
 * Lancia un errore leggibile; ritorna la serie se è valida.
 */
export function checkHourly(json, { start = null, durMin = 0, maxHours = 24 * 40 } = {}) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error('serie oraria assente');
  const n = h.time.length;
  if (n < 2 || n > maxHours) throw new Error(`serie oraria di ${n} ore`);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(h.time[i]) || (i && h.time[i] <= h.time[i - 1])) throw new Error('tempi non validi');
  }
  const missing = [];
  for (const k of HOURLY) {
    const v = h[k];
    if (!Array.isArray(v) || v.length !== n) { missing.push(k); continue; }
    if (v.some((x) => x !== null && !Number.isFinite(x))) throw new Error(`valori non numerici in ${k}`);
    if (!v.some((x) => x !== null)) missing.push(k);
  }
  if (missing.length) throw new Error(`variabili mancanti (${missing.join(', ')})`);
  if (start) {
    const t0 = start.getTime() / 1000, t1 = t0 + durMin * 60;
    if (h.time[0] > t0 - 86400 || h.time[n - 1] < t1 - 3600) throw new Error('la serie non copre il periodo della simulazione');
  }
  return json;
}
