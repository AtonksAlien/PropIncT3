# backend (Node.js)

Express + Socket.io. Elenca le zone, scarica il meteo (Open-Meteo, con cache), esegue il motore in `worker_threads` con **una sessione per client**, invia il tempo di arrivo in **binario**.

```bash
cd Software/backend
npm install
npm start        # http://localhost:3001  (PORT=... per cambiarla)
npm test         # 8 test end-to-end: server vero, client Socket.io veri, meteo finto (niente rete)
```

| File | Compito |
| --- | --- |
| `src/server.js` | Express (API REST) + Socket.io; `createServer()` usato anche dai test |
| `src/zones.js` | Zone da `config/zones/` e `data/zones/<id>/processed/`; angoli in lat/lon; layer pubblici |
| `src/sockets/session.js` | Protocollo Socket.io, validazione delle richieste, una simulazione per client |
| `src/workers/simWorker.js` | Una simulazione per worker: carica la zona e chiama `engine/simulate.js` |
| `src/weather/openmeteo.js` | Client Open-Meteo con cache su disco (archivio IFS o previsione ICON-2I); fonte, URL e controllo della serie in `engine/meteo-source.js`, condiviso con il browser |

## API REST

| Richiesta | Risposta |
| --- | --- |
| `GET /api/health` | `{ ok, workers, limits }` |
| `GET /api/zones` | `[{ id, name, ready, resolution_m, aoi_wgs84 }]` |
| `GET /api/zones/:id` | Griglia (`rows`, `cols`, `resolution_m`, `origin_utm`, `bounds_utm`), **4 angoli in lat/lon** (`corners_wgs84`: la griglia UTM è ruotata di circa 1,1° rispetto ai meridiani), layer, fonti, esito dei controlli |
| `GET /api/zones/:id/layers/:layer` | File `.npy` (`fuel`, `elevation`, `slope`, `aspect`, `ndvi`, `barriers` se generato), letto nel browser con `engine/npy.js` |

## Protocollo Socket.io

**Client → server**

`sim:start` con conferma (ack):

```js
socket.emit('sim:start', {
  zone: 'mercadante',
  hours: 3,                          // 0 < ore ≤ 12
  ignitions: [{ lat: 40.88, lon: 16.67 }],   // oppure { r, c }; da 1 a 20, su celle combustibili
  start: '2023-07-25T13:00:00+02:00',        // facoltativo: meteo reale Open-Meteo
  meteo: { model: 'ecmwf_ifs', json },       // facoltativo, con `start`: serie scaricata dal browser (vedi sotto)
  wind: { speed: 6, from: 240 },             // senza `start`: vento costante (m/s, gradi da cui proviene)
  barriers: true,                            // strade asfaltate e acqua (OSM) fermano il fuoco; default true
}, (ack) => { /* { ok: true, simId } oppure { ok: false, error } */ });
```

`sim:cancel` `{ simId }` con ack `{ ok }`.

**Server → client**

| Evento | Contenuto |
| --- | --- |
**Meteo scaricato dal browser.** Open-Meteo gratuito ha un limite giornaliero per indirizzo IP: su un hosting con
IP condiviso (Render) il server lo esaurisce presto. L'interfaccia scarica quindi la serie con la quota del visitatore
(Open-Meteo risponde con `access-control-allow-origin: *`) e la manda in `meteo`. Il server la usa solo se ha la
struttura di Open-Meteo e copre la simulazione (`checkHourly`), tenendo solo le variabili del motore; altrimenti
scarica da sé. La serie del browser non entra nella cache su disco, condivisa tra i client. `meta.meteoBy` dice
chi l'ha scaricata (`'browser'` o `'server'`).

| `sim:progress` | `{ simId, phase }`, con `phase` = `'meteo'` (solo con `start`) e poi `'calcolo'` |
| `sim:result` | `{ simId, meta, arrival }`: buffer **Float32 little-endian** di `rows × cols` valori, in minuti dall'innesco; `Infinity` = non raggiunta. `meta`: `burnedHa`, `burnedByHour`, `computeMs`, `fields` (campi di Rothermel calcolati), `ignitions` (celle), `weather.hourly` (temperatura, umidità, vento, umidità del combustibile ora per ora), `meteoModel`, `meteoBy` |
| `sim:error` | `{ simId, error }` (meteo non disponibile, errore nel worker) |
| `sim:cancelled` | `{ simId, reason }`: annullata dal client o sostituita da una nuova richiesta |

**Scelte e perché**

- **Worker per simulazione.** Una simulazione impiega da decine di millisecondi a qualche secondo (3 ore a Mercadante circa 0,15 s dal giorno 11; un incendio che brucia 4 milioni di celle circa 7 s, vedi [«Benchmark»](https://app.notion.com/p/41a42c7f043f81d5bd58c693dc0bb49a) su Notion); nel thread principale bloccherebbe il server per tutti. Un worker per richiesta rende l'annullamento banale (`terminate()`) e isola gli errori. Limite globale: numero di CPU − 1 worker (minimo 2).
- **Una sessione per client.** Ogni socket ha al più una simulazione attiva: una nuova richiesta annulla la precedente, la disconnessione la interrompe. I risultati vanno solo a chi li ha chiesti (il prototipo li inviava a tutti).
- **Meteo nel thread principale.** È solo I/O e la cache su disco è condivisa: due client sulla stessa data scaricano una volta sola.
- **Binario invece di JSON.** 360 000 tempi in Float32 occupano 1,4 MB; in JSON sarebbero circa 3–4 MB, e andrebbero riconvertiti.
- **Validazione prima del calcolo.** Zona, durata, inneschi (dentro la griglia, su celle combustibili e non su barriere attive), data e vento sono controllati e gli errori tornano subito nell'ack, con un messaggio leggibile.
- **Stesso codice della CLI.** Il worker chiama `engine/simulate.js` come la CLI: la stessa richiesta dà lo stesso risultato (verificato: 25/07/2023, innesco nelle stoppie, 580,5 ha in entrambi).

**Test** (`test/server.test.js`): REST (zone, informazioni, layer, 404 anche con tentativo di path traversal); risultato binario con la cella di innesco a 0 minuti; meteo scaricato una volta, fasi `meteo` → `calcolo`, campo di Rothermel ricalcolato nel tempo; meteo del browser usato senza chiamare Open-Meteo e, se non copre la simulazione, sostituito da quello del server; 5 richieste non valide; una nuova richiesta annulla la precedente senza risultati "fantasma"; annullamento esplicito e due client indipendenti in parallelo.
