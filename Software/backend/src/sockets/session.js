// Una sessione per client Socket.io: al massimo una simulazione attiva per client.
// Una nuova richiesta annulla quella in corso (il worker viene terminato); alla disconnessione idem.
//
// Protocollo (documentato in backend/README.md):
//   client → server  'sim:start'  (richiesta, ack) → ack({ ok: true, simId }) | ack({ ok: false, error })
//                    con una data, la richiesta può portare 'meteo': { model, json } scaricato dal browser
//                    (quota Open-Meteo del visitatore); se manca o non è valido, il meteo lo scarica il server
//                    'sim:cancel' ({ simId }, ack)  → ack({ ok })
//   server → client  'sim:progress'  { simId, phase: 'meteo' | 'calcolo' }
//                    'sim:result'    { simId, meta, arrival }   Float32 little-endian, rows×cols, minuti
//                    'sim:error'     { simId, error }
//                    'sim:cancelled' { simId }

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { isIgnitable, latLonToCell, withBarriers } from '../../../engine/grid.js';
import { fetchForSimulation, checkHourly, HOURLY } from '../weather/openmeteo.js';

const WORKER = new URL('../workers/simWorker.js', import.meta.url);
export const LIMITS = { maxHours: 12, maxIgnitions: 20, maxWorkers: Math.max(2, cpus().length - 1) };
let running = 0;     // worker attivi su tutto il server
let nextId = 1;

/** Controlla e normalizza una richiesta. Ritorna { job, weatherReq } oppure lancia un errore leggibile. */
export function validateRequest(req, zones) {
  if (!req || typeof req !== 'object') throw new Error('Richiesta mancante');
  const { zone, hours = 3, ignitions, start = null, wind = null, barriers = true, meteo = null } = req;
  if (!zones.exists(zone)) throw new Error(`Zona sconosciuta: ${zone}`);
  if (!zones.ready(zone)) throw new Error(`Zona ${zone} senza pacchetto: eseguire la pipeline`);
  if (!(Number(hours) > 0 && Number(hours) <= LIMITS.maxHours)) throw new Error(`Durata tra 0 e ${LIMITS.maxHours} ore`);
  if (!Array.isArray(ignitions) || ignitions.length < 1 || ignitions.length > LIMITS.maxIgnitions) {
    throw new Error(`Da 1 a ${LIMITS.maxIgnitions} inneschi`);
  }
  const base = zones.fuelGrid(zone);
  // barriere: true = attraversabili secondo la lunghezza di fiamma (D46), 'assolute', false = nessuna
  const mode = barriers === false || barriers === 'nessuna' ? false : barriers === 'assolute' ? 'assolute' : true;
  const grid = mode === false ? base : withBarriers(base, { absolute: mode === 'assolute' });
  const cells = ignitions.map((p) => {
    const cell = Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? latLonToCell(grid, p.lat, p.lon) : { r: p?.r, c: p?.c };
    if (!isIgnitable(base, cell)) throw new Error(`Innesco fuori zona o su cella non combustibile: ${JSON.stringify(p)}`);
    if (!isIgnitable(grid, cell)) throw new Error(`Innesco su una barriera (strada, ferrovia o acqua): scegliere un altro punto o disattivare le barriere`);
    return cell;
  });
  let startDate = null;
  if (start) {
    startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) throw new Error(`Data di innesco non valida: ${start}`);
  }
  const w = { speed: Number(wind?.speed ?? 0), from: Number(wind?.from ?? 0) };
  if (!startDate && !(w.speed >= 0 && w.speed <= 40 && w.from >= 0 && w.from <= 360)) {
    throw new Error('Vento non valido: speed 0–40 m/s, from 0–360°');
  }
  return {
    // vento a conservazione della massa (D53); strato limite fisso a 1000 m quando manca il dato orario
    job: { ignitions: cells, maxMin: Number(hours) * 60, barriers: mode, terrainWind: { method: 'massa', blhM: 1000 } },
    weatherReq: { zone, start: startDate, wind: w, client: startDate ? clientMeteo(meteo, startDate, Number(hours) * 60) : null },
  };
}

/**
 * Meteo scaricato dal browser: usato solo se ha la struttura di Open-Meteo e copre la simulazione. Non entra
 * nella cache su disco, condivisa tra i client: vale solo per la simulazione di chi lo ha mandato.
 * @returns { json, model } oppure null (il server lo scaricherà da sé)
 */
function clientMeteo(meteo, start, durMin) {
  if (!meteo || typeof meteo !== 'object') return null;
  try {
    const src = meteo.json?.hourly;   // solo le variabili usate dal motore
    const json = { hourly: src && typeof src === 'object' ? Object.fromEntries(['time', ...HOURLY].map((k) => [k, src[k]])) : null };
    checkHourly(json, { start, durMin });
    const model = typeof meteo.model === 'string' && /^[a-z0-9_]{1,40}$/.test(meteo.model) ? meteo.model : 'sconosciuto';
    return { json, model };
  } catch {
    return null;
  }
}

export function attachSession(socket, zones, root, { fetchWeather = fetchForSimulation } = {}) {
  const session = { simId: null, worker: null };

  const stop = (reason) => {
    if (session.worker) { session.worker.terminate(); session.worker = null; running--; }
    if (session.simId && reason) socket.emit('sim:cancelled', { simId: session.simId, reason });
    session.simId = null;
  };

  socket.on('sim:start', async (req, ack = () => {}) => {
    let parsed;
    try { parsed = validateRequest(req, zones); } catch (err) { ack({ ok: false, error: err.message }); return; }
    if (session.simId) stop('sostituita da una nuova simulazione');
    if (running >= LIMITS.maxWorkers) { ack({ ok: false, error: 'Server occupato: riprovare tra poco' }); return; }

    const simId = `s${nextId++}`;
    session.simId = simId;
    ack({ ok: true, simId });
    const { job, weatherReq } = parsed;
    const current = () => session.simId === simId;

    // 1. meteo (nel thread principale: è solo I/O, e la cache su disco è condivisa tra i client)
    let weather = { hourlyJson: null, start: null, wind: weatherReq.wind };
    if (weatherReq.start) {
      socket.emit('sim:progress', { simId, phase: 'meteo' });
      try {
        if (weatherReq.client) {   // scaricato dal browser del visitatore
          weather = { hourlyJson: weatherReq.client.json, start: weatherReq.start.toISOString(), wind: null, model: weatherReq.client.model, by: 'browser' };
        } else {
          const cfg = zones.config(weatherReq.zone);
          const r = await fetchWeather(cfg.meteo_point_wgs84, weatherReq.start, job.maxMin, { cacheDir: zones.meteoCacheDir(weatherReq.zone) });
          weather = { hourlyJson: r.json, start: weatherReq.start.toISOString(), wind: null, model: r.model, kind: r.source, by: 'server' };
        }
      } catch (err) {
        if (current()) { socket.emit('sim:error', { simId, error: `Meteo non disponibile: ${err.message}` }); session.simId = null; }
        return;
      }
      if (!current()) return;   // nel frattempo il client ha chiesto un'altra simulazione o si è scollegato
    }

    // 2. calcolo nel worker
    socket.emit('sim:progress', { simId, phase: 'calcolo' });
    const worker = new Worker(WORKER, {
      workerData: { zoneDir: zones.processedDir(weatherReq.zone), fuelTable: join(root, 'pipeline', 'tables', 'fuel_models.csv'), job, weather },
    });
    session.worker = worker; running++;
    const finish = () => { if (session.worker === worker) { session.worker = null; session.simId = null; running--; } };
    worker.once('message', (msg) => {
      if (!current()) return;
      if (msg.type === 'result') {
        const info = zones.info(weatherReq.zone);
        socket.emit('sim:result', {
          simId,
          meta: {
            ...msg.meta, zone: weatherReq.zone, maxMin: job.maxMin, ignitions: job.ignitions,
            rows: info.rows, cols: info.cols, encoding: 'float32-le', unit: 'minuti', unreached: 'Infinity',
            start: weather.start, meteoModel: weather.model ?? null, meteoBy: weather.by ?? null,
            barriers: zones.fuelGrid(weatherReq.zone).barriers ? job.barriers : false,
          },
          arrival: Buffer.from(msg.arrival),
        });
      } else {
        socket.emit('sim:error', { simId, error: msg.error });
      }
      finish();
    });
    worker.once('error', (err) => { if (current()) socket.emit('sim:error', { simId, error: err.message }); finish(); });
  });

  socket.on('sim:cancel', ({ simId } = {}, ack = () => {}) => {
    const ok = Boolean(simId) && simId === session.simId;
    if (ok) stop('annullata dal client');
    ack({ ok });
  });

  socket.on('disconnect', () => stop(null));
}

export const workersRunning = () => running;
