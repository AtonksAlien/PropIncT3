# PropInc — Software

Codice del simulatore di propagazione degli incendi boschivi. Presentazione del progetto, risultati e avvio rapido: [`../README.md`](../README.md). Documentazione di progetto: su Notion ([«PropInc — Tesi triennale»](https://app.notion.com/p/41a42c7f043f81aa9eadffbdc95c5325)).

```bash
npm run setup     # una volta: dipendenze di server e interfaccia, compilazione dell'interfaccia
npm start         # http://localhost:3001
npm run test:all  # 49 test di motore e pipeline + 8 test end-to-end del server
```

Serve Node.js ≥ 20. Il motore e gli esperimenti non hanno dipendenze esterne; server e interfaccia le installano con `npm run setup` (versioni fissate nei `package-lock.json`).

| Cartella | Linguaggio | Contenuto | README |
| --- | --- | --- | --- |
| `config/` | JSON | Definizione delle zone (area, sistema di riferimento, risoluzione, punto meteo) | [config](config/README.md) |
| `pipeline/` | Python, JavaScript | Dai dati grezzi al pacchetto zona; barriere da OpenStreetMap | [pipeline](pipeline/README.md) |
| `engine/` | JavaScript puro | Modello di Rothermel + tempo minimo di arrivo, meteo, proiezione UTM, CLI | [engine](engine/README.md) |
| `backend/` | Node.js | Express + Socket.io, meteo con cache, una simulazione per client in un worker | [backend](backend/README.md) |
| `frontend/` | React + Leaflet | Mappa, inneschi, meteo, riproduzione con isocrone | [frontend](frontend/README.md) |
| `experiments/` | JavaScript | Esperimenti E1–E5 e benchmark; figure in `../Documenti/figure/` | [experiments](experiments/README.md) |
| `validation/` | JavaScript | Confronto con incendi reali: perimetro, punti caldi FIRMS, riferimenti ingenui | [validation](validation/README.md) |
| `tests/` | JavaScript | Test di motore e pipeline (`npm test`); quelli del server sono in `backend/test/` | [tests](tests/README.md) |
| `data/zones/` | — | Pacchetto zona `processed/` **incluso** (circa 10 MB); dati grezzi `raw/` esclusi tranne il meteo del 25/07/2023 | [licenze](data/LICENZE_DATI.md) |

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm run setup` | `npm ci` in `backend/` e `frontend/`, poi compila l'interfaccia in `frontend/dist/` |
| `npm start` | Server su http://localhost:3001 (`PORT=…` per cambiare porta) con l'interfaccia compilata |
| `npm test` · `npm run test:server` · `npm run test:all` | Test di motore e pipeline · del server · tutti |
| `npm run sim -- <opzioni>` | Simulazione da riga di comando (`engine/cli.js`: `--zone`, `--date`, `--wind`, `--ignite`, `--hours`, `--barriers on|off`, `--png`, `--ros`) |
| `npm run experiments` | Esperimenti E1–E5 (circa 10 s) |
| `npm run bench` | Benchmark fino a 2000² celle (circa 90 s) |
| `npm run validate -- --case <caso>` | Validazione su un incendio reale (`config/validation/<caso>.json`) |

Sviluppo dell'interfaccia con ricarica automatica: `npm start` in un terminale e `npm run dev --prefix frontend` in un altro (http://localhost:5173, inoltra API e Socket.io alla porta 3001).

Zona campione: **mercadante** (`config/zones/mercadante.json`). Per una nuova zona: un nuovo file in `config/zones/`, i dati grezzi in `data/zones/<zona>/raw/` e la pipeline (`pipeline/README.md`).
