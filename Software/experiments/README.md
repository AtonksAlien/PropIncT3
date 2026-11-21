# experiments (JavaScript)

Esperimenti di sensibilità del modello (Rothermel + tempo di arrivo). Usano direttamente il motore (`engine/`), senza server.

```bash
cd Software
node experiments/run.js          # tutti (circa 8 s)
node experiments/run.js e1 e5    # solo alcuni
```

| Esperimento | Domanda | Uscite |
| --- | --- | --- |
| `e1` | Velocità della testa al variare del vento (erba, macchia, pineta) | `e1_vento.svg/.csv` |
| `e2` | Velocità verso monte al variare della pendenza | `e2_pendenza.svg/.csv` |
| `e3` | Velocità al variare dell'umidità del combustibile morto | `e3_umidita.svg/.csv` |
| `e4` | Velocità nella pineta al variare di copertura e altezza delle chiome (DECISIONI D18) | `e4_chiome.svg/.csv` |
| `e5` | Effetto delle barriere OSM (strade asfaltate e acqua) su 30 inneschi reali | `e5_barriere.svg/.csv` |

**Benchmark (giorno 11):** `node experiments/bench.js` (circa 90 s; `--charts` ridisegna senza rimisurare) misura tempo e memoria da 250² a 2000² celle, un processo per prova; uscite in `Documenti/figure/benchmark/`, relazione in [«Benchmark»](https://app.notion.com/p/41a42c7f043f81d5bd58c693dc0bb49a) su Notion.

Le uscite degli esperimenti vanno in `Documenti/figure/esperimenti/` (figura e dati accanto, così ogni figura si rigenera), con `index.html` per sfogliarle e `risultati.json` con i numeri. Risultati e commento: [«Esperimenti»](https://app.notion.com/p/41a42c7f043f815baf14e259133c41c4) su Notion.

- **Riproducibili:** inneschi estratti con un seme fisso (2026, `lib/rng.js`), meteo del 25/07/2023 letto dalla cache `data/zones/mercadante/raw/meteo/` (serve averlo scaricato una volta, ad esempio con `node engine/cli.js --date 2023-07-25T13:00+02:00`).
- **Veloci:** nel caso reale il meteo è uguale per tutti gli inneschi, quindi i campi di Rothermel si calcolano una volta e si condividono (30 simulazioni in circa 4 s).
- **Grafici** (`lib/svgchart.js`): SVG senza dipendenze, palette categoriale validata con lo script della skill dataviz (blu, arancio, verde acqua, giallo; contrasto basso degli ultimi due compensato da etichette dirette e tabelle CSV), un solo asse y, legenda ed etichette a fine linea, tooltip al passaggio del mouse.
