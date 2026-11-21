// Server PropInc: API REST per le zone, Socket.io per le simulazioni.
//
//   cd Software/backend && npm install && npm start          (porta 3001, oppure PORT=...)
//
// REST  GET /api/health
//       GET /api/zones                       elenco delle zone
//       GET /api/zones/:id                   griglia, angoli in lat/lon, layer, fonti, controlli
//       GET /api/zones/:id/layers/:layer     file .npy (fuel, elevation, slope, aspect, ndvi)
// Socket.io: vedi src/sockets/session.js e README.md.

import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Zones } from './zones.js';
import { attachSession, LIMITS, workersRunning } from './sockets/session.js';

export const SOFTWARE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// CORS: per default solo la stessa origine (l'interfaccia è servita da questo server; in sviluppo passa dal
// proxy di Vite). CORS_ORIGIN=http://… per consentire un'altra origine.
export function createServer({ root = SOFTWARE_ROOT, corsOrigin = process.env.CORS_ORIGIN ?? false, fetchWeather } = {}) {
  const zones = new Zones(root);
  const app = express();

  app.get('/api/health', (_req, res) => res.json({ ok: true, workers: workersRunning(), limits: LIMITS }));
  app.get('/api/zones', (_req, res) => res.json(zones.list()));
  app.get('/api/zones/:id', (req, res) => {
    if (!zones.ready(req.params.id)) return res.status(404).json({ error: 'Zona non trovata o senza pacchetto' });
    res.json(zones.info(req.params.id));
  });
  app.get('/api/zones/:id/layers/:layer', (req, res) => {
    const { id, layer } = req.params;
    const file = zones.ready(id) && zones.layerPath(id, layer);
    if (!file) return res.status(404).json({ error: 'Layer non disponibile' });
    // dotfiles 'allow': il percorso è costruito dal server da id validati, ma può contenere cartelle
    // nascoste (es. un worktree in .claude/), che `send` altrimenti rifiuta con 404.
    res.type('application/octet-stream').sendFile(file, { dotfiles: 'allow' });
  });

  // Interfaccia web già compilata (cd frontend && npm run build): stessa origine, niente CORS né proxy.
  const dist = join(root, 'frontend', 'dist');
  if (existsSync(dist)) app.use(express.static(dist, { dotfiles: 'allow' }));

  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, { cors: { origin: corsOrigin }, maxHttpBufferSize: 1e6 });
  io.on('connection', (socket) => attachSession(socket, zones, root, fetchWeather ? { fetchWeather } : {}));

  return {
    app, io, httpServer, zones,
    listen: (port = 3001) => new Promise((ok) => httpServer.listen(port, () => ok(httpServer.address().port))),
    close: () => new Promise((ok) => { io.close(); httpServer.close(() => ok()); }),
  };
}

// Avvio diretto: node src/server.js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  const port = await server.listen(Number(process.env.PORT ?? 3001));
  console.log(`PropInc backend su http://localhost:${port} — zone: ${server.zones.list().map((z) => z.id).join(', ')}`);
}
