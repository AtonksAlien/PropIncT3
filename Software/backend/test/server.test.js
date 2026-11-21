// Test end-to-end del backend: server vero su porta casuale, client Socket.io veri, meteo finto (niente rete).
//   cd Software/backend && npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { createServer, SOFTWARE_ROOT } from '../src/server.js';
import { utmToLatLon, latLonToUtm } from '../../engine/geo.js';

const READY = existsSync(join(SOFTWARE_ROOT, 'data/zones/mercadante/processed/manifest.json'));
const PINE = utmToLatLon(641942, 4527290);          // centro della pineta
const GRASS = utmToLatLon(639000 + 200 * 10 + 5, 4530000 - 480 * 10 - 5);   // stoppie, cella r480 c200

let server, url, weatherCalls = 0;
// Meteo finto: 5 giorni orari, 35 °C, 20%, vento 6 m/s da 240°
const fakeWeather = async (_point, start) => {
  weatherCalls++;
  const t0 = Math.floor(start.getTime() / 86400e3) * 86400 - 3 * 86400;
  const n = 5 * 24, fill = (v) => Array(n).fill(v);
  return { source: 'archivio', model: 'finto', fromCache: false, json: { hourly: {
    time: Array.from({ length: n }, (_, i) => t0 + i * 3600), temperature_2m: fill(35), relative_humidity_2m: fill(20),
    wind_speed_10m: fill(6), wind_direction_10m: fill(240), wind_gusts_10m: fill(12), precipitation: fill(0) } } };
};

before(async () => {
  server = createServer({ fetchWeather: fakeWeather });
  url = `http://localhost:${await server.listen(0)}`;
});
after(() => server.close());

const client = () => new Promise((ok) => { const s = connect(url, { transports: ['websocket'] }); s.on('connect', () => ok(s)); });
const once = (s, ev, pred = () => true) => new Promise((ok) => { const h = (m) => { if (pred(m)) { s.off(ev, h); ok(m); } }; s.on(ev, h); });
const start = (s, req) => new Promise((ok) => s.emit('sim:start', req, ok));
const f32 = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

test('geo: i test del backend usano inneschi coerenti con la griglia', () => {
  const p = latLonToUtm(PINE.lat, PINE.lon);
  assert.ok(Math.abs(p.x - 641942) < 1e-3 && Math.abs(p.y - 4527290) < 1e-3);
});

test('REST: elenco zone, informazioni, layer .npy, 404', { skip: !READY && 'pacchetto assente' }, async () => {
  const zones = await (await fetch(`${url}/api/zones`)).json();
  // mercadante è pronta; altre zone configurate (es. dualchi, in attesa dei dati) dicono se hanno il pacchetto
  assert.equal(zones.find((z) => z.id === 'mercadante')?.ready, true);
  for (const z of zones) assert.equal(typeof z.ready, 'boolean');
  const info = await (await fetch(`${url}/api/zones/mercadante`)).json();
  assert.equal(info.rows, 600); assert.equal(info.cols, 600);
  assert.ok(info.corners_wgs84.nw[1] > info.corners_wgs84.sw[1], 'griglia UTM ruotata: NO più a Est di SO');
  const npy = new Uint8Array(await (await fetch(`${url}/api/zones/mercadante/layers/fuel`)).arrayBuffer());
  assert.equal(npy[0], 0x93); assert.ok(npy.length >= 360000);
  assert.equal((await fetch(`${url}/api/zones/mercadante/layers/clc`)).status, 404);
  assert.equal((await fetch(`${url}/api/zones/..%2Fsecret`)).status, 404);
});

test('Socket.io: richiesta e risultato binario', { skip: !READY && 'pacchetto assente' }, async () => {
  const s = await client();
  try {
    const progress = [];
    s.on('sim:progress', (m) => progress.push(m.phase));
    const ack = await start(s, { zone: 'mercadante', hours: 1, ignitions: [GRASS], wind: { speed: 6, from: 240 } });
    assert.equal(ack.ok, true, ack.error);
    const res = await once(s, 'sim:result');
    assert.equal(res.simId, ack.simId);
    const arrival = f32(res.arrival);
    assert.equal(arrival.length, 600 * 600);
    assert.equal(arrival[480 * 600 + 200], 0, 'la cella di innesco brucia al minuto 0');
    assert.ok(res.meta.burnedHa > 1 && res.meta.burnedByHour.length === 1);
    assert.equal(res.meta.encoding, 'float32-le');
    assert.deepEqual(progress, ['calcolo']);
  } finally { s.close(); }
});

test('Socket.io: con la data scarica il meteo e lo usa', { skip: !READY && 'pacchetto assente' }, async () => {
  const s = await client();
  try {
    const before = weatherCalls, progress = [];
    s.on('sim:progress', (m) => progress.push(m.phase));
    const ack = await start(s, { zone: 'mercadante', hours: 1, ignitions: [PINE], start: '2023-07-25T11:00:00Z' });
    assert.equal(ack.ok, true, ack.error);
    const res = await once(s, 'sim:result');
    assert.equal(weatherCalls, before + 1);
    assert.deepEqual(progress, ['meteo', 'calcolo']);
    assert.equal(res.meta.weather.source, 'open-meteo');
    assert.ok(Math.abs(res.meta.weather.hourly[0].windFrom - 240) < 1e-6);
    assert.ok(res.meta.fields >= 6, 'meteo variabile: il campo di Rothermel si ricalcola ogni 10 minuti');
  } finally { s.close(); }
});

test('Socket.io: meteo scaricato dal browser usato senza chiamare Open-Meteo; se non è valido lo scarica il server', { skip: !READY && 'pacchetto assente' }, async () => {
  const s = await client();
  try {
    const startIso = '2023-07-25T11:00:00Z';
    const { json } = await fakeWeather(null, new Date(startIso));
    json.hourly.wind_direction_10m = json.hourly.wind_direction_10m.map(() => 300);   // diverso dal meteo del server
    const before = weatherCalls;
    const ack = await start(s, { zone: 'mercadante', hours: 1, ignitions: [PINE], start: startIso, meteo: { model: 'ecmwf_ifs', json } });
    assert.equal(ack.ok, true, ack.error);
    const res = await once(s, 'sim:result');
    assert.equal(weatherCalls, before, 'nessuna chiamata del server a Open-Meteo');
    assert.equal(res.meta.meteoBy, 'browser');
    assert.equal(res.meta.meteoModel, 'ecmwf_ifs');
    assert.ok(Math.abs(res.meta.weather.hourly[0].windFrom - 300) < 1e-6);
    // serie che non copre la simulazione (finisce il giorno prima): scartata, il server scarica la sua
    const short = { hourly: Object.fromEntries(Object.entries(json.hourly).map(([k, v]) => [k, v.slice(0, 48)])) };
    const ack2 = await start(s, { zone: 'mercadante', hours: 1, ignitions: [PINE], start: startIso, meteo: { model: 'x', json: short } });
    assert.equal(ack2.ok, true, ack2.error);
    const res2 = await once(s, 'sim:result');
    assert.equal(weatherCalls, before + 1);
    assert.equal(res2.meta.meteoBy, 'server');
  } finally { s.close(); }
});

test('Socket.io: richieste non valide rifiutate con un messaggio chiaro', { skip: !READY && 'pacchetto assente' }, async () => {
  const s = await client();
  try {
    const bad = [
      [{ zone: 'atlantide', ignitions: [PINE] }, /Zona sconosciuta/],
      [{ zone: 'mercadante', ignitions: [] }, /inneschi/],
      [{ zone: 'mercadante', ignitions: [{ lat: 45, lon: 9 }] }, /fuori zona/],
      [{ zone: 'mercadante', hours: 48, ignitions: [PINE] }, /Durata/],
      [{ zone: 'mercadante', ignitions: [PINE], start: 'ieri' }, /Data/],
    ];
    for (const [req, re] of bad) {
      const ack = await start(s, req);
      assert.equal(ack.ok, false); assert.match(ack.error, re);
    }
  } finally { s.close(); }
});

test('Socket.io: una nuova richiesta annulla quella in corso (una simulazione per client)', { skip: !READY && 'pacchetto assente' }, async () => {
  const s = await client();
  try {
    const results = [];
    s.on('sim:result', (m) => results.push(m.simId));
    const first = await start(s, { zone: 'mercadante', hours: 12, ignitions: [GRASS], start: '2023-07-25T11:00:00Z' });
    const cancelled = once(s, 'sim:cancelled');
    const second = await start(s, { zone: 'mercadante', hours: 1, ignitions: [PINE], wind: { speed: 3, from: 0 } });
    assert.equal((await cancelled).simId, first.simId);
    await once(s, 'sim:result', (m) => m.simId === second.simId);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.deepEqual(results, [second.simId], 'nessun risultato dalla simulazione annullata');
  } finally { s.close(); }
});

test('Socket.io: annullamento esplicito e client indipendenti', { skip: !READY && 'pacchetto assente' }, async () => {
  const [a, b] = [await client(), await client()];
  try {
    const ackA = await start(a, { zone: 'mercadante', hours: 12, ignitions: [GRASS], wind: { speed: 8, from: 240 } });
    const ackB = await start(b, { zone: 'mercadante', hours: 1, ignitions: [PINE], wind: { speed: 2, from: 90 } });
    const resB = await once(b, 'sim:result');
    assert.equal(resB.simId, ackB.simId, 'B riceve il suo risultato mentre A calcola');
    const c = await new Promise((ok) => a.emit('sim:cancel', { simId: ackA.simId }, ok));
    assert.equal(c.ok, true);
    const wrong = await new Promise((ok) => a.emit('sim:cancel', { simId: 'nessuna' }, ok));
    assert.equal(wrong.ok, false);
  } finally { a.close(); b.close(); }
});
