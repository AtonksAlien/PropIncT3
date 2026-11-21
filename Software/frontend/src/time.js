// Ora locale italiana ↔ UTC, indipendente dal fuso del computer che apre la pagina.
const ZONE = 'Europe/Rome';

/** Scarto (minuti) di Europe/Rome rispetto a UTC all'istante ms. */
function offsetMinutes(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}

/** "2023-07-25T13:00" (ora italiana) → "2023-07-25T11:00:00.000Z". */
export function romeLocalToISO(value) {
  const [d, t] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const off = offsetMinutes(guess - offsetMinutes(guess) * 60000);
  return new Date(guess - off * 60000).toISOString();
}

/** Ora italiana "HH:MM" di un istante. */
export function romeClock(ms) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export const fmtMinutes = (m) => `${Math.floor(m / 60)} h ${String(Math.floor(m % 60)).padStart(2, '0')} min`;

/** Ora italiana attuale, arrotondata all'ora, nel formato di <input type="datetime-local">. */
export function romeNowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

/**
 * Fonte meteo che il server userà per [inizio, inizio + durata] (stessa regola di backend/src/weather/openmeteo.js):
 * oltre 7 giorni fa archivio ECMWF IFS (ERA5 prima del 2017), poi ICON-2I fino a 2 giorni nel futuro.
 * @returns { ok, label } — ok = false se la finestra non è coperta
 */
export function meteoSourceFor(startIso, hours, now = Date.now()) {
  const start = Date.parse(startIso), end = start + hours * 3600e3, day = 86400e3;
  if (Number.isNaN(start)) return { ok: false, label: 'Data non valida' };
  if (end > now + 2 * day) return { ok: false, label: 'Oltre la previsione disponibile (ICON-2I arriva a 2 giorni)' };
  if (start < Date.UTC(1940, 0, 1)) return { ok: false, label: 'Prima del 1940: nessun dato meteo' };
  if (end <= now - 7 * day) {
    return start >= Date.UTC(2017, 0, 1)
      ? { ok: true, label: 'Archivio ECMWF IFS (9 km)' }
      : { ok: true, label: 'Archivio ERA5 (25 km)' };
  }
  return { ok: true, label: end > now ? 'Previsione ICON-2I (2,2 km)' : 'ICON-2I, ultimi giorni (2,2 km)' };
}
