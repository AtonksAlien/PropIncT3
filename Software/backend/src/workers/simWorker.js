// Worker di calcolo: una simulazione per worker (worker_threads).
// Perché in un thread separato: una simulazione lunga impiega alcuni secondi; nel thread principale
// bloccherebbe il server per tutti i client. Annullare una simulazione = terminare il worker.
//
// Ingresso (workerData): { zoneDir, fuelTable, job: { ignitions, maxMin, barriers },
//                          weather: { hourlyJson | null, start (ISO) | null, wind: { speed, from } } }
// Uscita (messaggi): { type: 'result', arrival (ArrayBuffer trasferito), meta } oppure { type: 'error', error }

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { loadZone } from '../../../engine/load-node.js';
import { parseFuelModels } from '../../../engine/fuels.js';
import { makeWeather, simulate, burnedByHour } from '../../../engine/simulate.js';

try {
  const { zoneDir, fuelTable, job, weather } = workerData;
  const t0 = performance.now();
  const grid = loadZone(zoneDir);
  const models = parseFuelModels(readFileSync(fuelTable, 'utf8'));
  const wx = makeWeather({
    hourlyJson: weather.hourlyJson, start: weather.start ? new Date(weather.start) : null,
    wind: weather.wind, durMin: job.maxMin,
  });
  const r = simulate(grid, models, job, wx);
  const meta = {
    burnedHa: r.burnedHa, burnedCells: r.burnedCells, burnedByHour: burnedByHour(grid, r.arrival, job.maxMin),
    fields: r.fields ?? null, computeMs: r.ms, totalMs: performance.now() - t0,
    weather: { source: wx.source, live: wx.live, hourly: wx.hourly },
  };
  parentPort.postMessage({ type: 'result', arrival: r.arrival.buffer, meta }, [r.arrival.buffer]);
} catch (err) {
  parentPort.postMessage({ type: 'error', error: err.message });
}
