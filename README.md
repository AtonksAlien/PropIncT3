# PropInc — simulatore di propagazione degli incendi boschivi

**Tesi triennale · Andrea Losacco · 2026**

PropInc simula come si propaga un incendio di superficie su un territorio reale, a partire da uno o più punti di innesco e dal meteo di una data scelta. La zona di studio è la **Foresta di Mercadante** (Murge, Bari): 6 × 6 km in celle da 10 m.

Il modello di propagazione è fisico:

| | |
| --- | --- |
| Idea | Il fuoco raggiunge ogni cella per il percorso più veloce |
| Basi | Rothermel (1972) + Albini (1976), ellisse di Anderson (1983), tempo minimo di arrivo con Dijkstra su 16 direzioni (Finney 2002) |
| Ingressi | Combustibile (13 modelli di Anderson), pendenza ed esposizione, vento e umidità del combustibile dal meteo orario |
| Verifica | 20 valori di riferimento della libreria Behave (US Forest Service) riprodotti entro 10⁻⁶; test del cerchio (errore 2,7%) e dell'ellisse; validazione sull'incendio di Dualchi 2019 (Copernicus EMS EMSR377) |

Strade asfaltate e acqua da OpenStreetMap possono fare da barriera, e il meteo arriva da Open-Meteo: archivio ECMWF IFS per il passato, ICON-2I (2,2 km) per la previsione.

## Risultati principali

- **Sensibilità fisica:** nell'erba la velocità della testa va da 1,4 a 90 m/min al variare del vento (da 0 a 12 m/s), nella macchia da 2,0 a 131 m/min; il fuoco si spegne all'umidità di estinzione di ogni combustibile.
- **Prestazioni:** 4 milioni di celle (20 × 20 km) bruciate in 6,9 s con 261 MB; 3 ore di incendio reale costano meno di 0,4 s.
- **Barriere:** con strade e acqua l'area mediana si riduce dell'11%, fino al −76% per un incendio d'erba fermato da una strada.
- **Validazione su un incendio reale** (Dualchi, 6 agosto 2019, 326 ha): a parità di area l'indice di Sørensen è del 31,5% con le strade OSM trattate come barriere invalicabili e del **61,9% senza barriere**, contro il 45,1% dell'ellisse orientata con il vento medio. Le barriere assolute erano la causa principale dell'errore: è in corso una regola fisica per l'attraversamento delle strade.

Dettagli, figure e tabelle: [«Esperimenti»](https://app.notion.com/p/41a42c7f043f815baf14e259133c41c4) su Notion, [«Benchmark»](https://app.notion.com/p/41a42c7f043f81d5bd58c693dc0bb49a) su Notion, figure in [`Documenti/figure/`](Documenti/figure/).

## Avvio rapido

Serve **Node.js 20 o successivo** (sviluppato con Node 22.14) e Git. Il pacchetto dati della zona è incluso nel repository.

```bash
git clone https://github.com/AtonksAlien/PropInc.git
cd PropInc/Software
npm run setup        # installa server e interfaccia, compila l'interfaccia (circa 1 minuto)
npm start            # apre il server su http://localhost:3001
```

Apri **http://localhost:3001**, clicca sulla mappa per mettere un innesco, scegli la data (meteo reale) o un vento costante, premi «Simula». La riproduzione mostra il fronte e le isocrone orarie.

| Comando (da `Software/`) | Cosa fa |
| --- | --- |
| `npm test` | Test di motore, pipeline e validazione (50) |
| `npm run test:all` | Anche i test end-to-end del server (7) |
| `npm run sim -- --date 2023-07-25T13:00+02:00 --png out/sim.png` | Simulazione da riga di comando, immagine del risultato |
| `npm run experiments` | Rigenera i 5 esperimenti di sensibilità (figure SVG e tabelle CSV), circa 10 s |
| `npm run bench` | Benchmark di tempo e memoria fino a 2000² celle, circa 90 s |
| `npm run validate -- --case esempio-mercadante` | Confronto con un incendio osservato (perimetro e punti caldi FIRMS); per il caso reale vedi [«Dati di validazione»](https://app.notion.com/p/41a42c7f043f81d584f4caff491e80fe) su Notion |

Senza rete funzionano tutti i comandi con la data del 25 luglio 2023 o con vento costante; per altre date serve la connessione a Open-Meteo, e i dati scaricati restano in cache.

## Struttura

```text
PropInc/
├── Software/            codice
│   ├── pipeline/        dai dati grezzi al pacchetto zona (Python; barriere OSM in JavaScript)
│   ├── engine/          modello di Rothermel e tempo di arrivo, meteo, proiezione UTM (JavaScript puro)
│   ├── backend/         server Express + Socket.io, una simulazione per client in un worker
│   ├── frontend/        interfaccia React + Leaflet
│   ├── experiments/     esperimenti e benchmark
│   ├── validation/      confronto con incendi reali (perimetro, punti caldi FIRMS)
│   ├── tests/           test di motore e pipeline
│   ├── config/          definizione delle zone
│   └── data/            pacchetto zona incluso; dati grezzi esclusi (licenze in data/LICENZE_DATI.md)
└── Documenti/figure/    figure della tesi (esperimenti, benchmark), rigenerate dagli script
```

Ogni cartella di `Software/` ha un README con i dettagli: [pipeline](Software/pipeline/README.md), [motore](Software/engine/README.md), [server e protocollo](Software/backend/README.md), [interfaccia](Software/frontend/README.md), [esperimenti](Software/experiments/README.md), [validazione](Software/validation/README.md), [test](Software/tests/README.md).

## Documentazione

Dal 16 novembre 2026 la documentazione di progetto (progetto, roadmap, decisioni, dati, diario, problemi noti, esperimenti, benchmark, capitoli della tesi, fonti) è **su Notion**, nello spazio [«PropInc — Tesi triennale»](https://app.notion.com/p/41a42c7f043f81aa9eadffbdc95c5325): si aggiorna lì, non nel repository. Le pagine sono private: chi clona il repository trova qui i README del codice e le figure in `Documenti/figure/`.

| Pagina Notion | Contenuto |
| --- | --- |
| [Progetto](https://app.notion.com/p/41a42c7f043f8158b87ff8c081c83206) · [Roadmap](https://app.notion.com/p/41a42c7f043f81b7a06edf54665f85d3) | Cosa si costruisce e perché; piano e traguardi |
| [Struttura del progetto](https://app.notion.com/p/41a42c7f043f816e8033e49d7228eb22) | Ogni file del repository: a cosa serve e come funziona |
| [Consegna](https://app.notion.com/p/41a42c7f043f81fa88e9d9e04382a424) · [Decisioni](https://app.notion.com/p/41a42c7f043f81af82a8d3648d0ad741) | Stato finale e cose che restano; scelte tecniche con il motivo |
| [Dati grezzi](https://app.notion.com/p/41a42c7f043f815aa9bae3b5db73b15a) · [Dati di validazione](https://app.notion.com/p/41a42c7f043f81d584f4caff491e80fe) · [Verifica in QGIS](https://app.notion.com/p/41a42c7f043f81079991dbf8c261f1f9) | Fonti e trattamento dei dati; incendio di Dualchi 2019; controllo visivo del pacchetto zona |
| [Problemi noti](https://app.notion.com/p/41a42c7f043f8139a956ebc089a7d27c) · [Diario](https://app.notion.com/p/41a42c7f043f8166aaf6d7c778c436b7) | Difetti e limiti; registro del lavoro |
| [Esperimenti](https://app.notion.com/p/41a42c7f043f815baf14e259133c41c4) · [Benchmark](https://app.notion.com/p/41a42c7f043f81d5bd58c693dc0bb49a) | Risultati |
| [Fonti esterne](https://app.notion.com/p/41a42c7f043f815faa63db0b40b6687f) · [Bibliografia](https://app.notion.com/p/41a42c7f043f81f18b00f2e7fd0d9f76) | Fonti consultate e riferimenti da citare |

## Rigenerare i dati della zona

Il pacchetto incluso basta per usare il simulatore. Per rigenerarlo dai dati grezzi (DEM TINITALY, CORINE 2018, immagine NDVI Sentinel-2, circa 200 MB, non inclusi) servono Python 3 con `numpy` e `rasterio` (`Software/pipeline/requirements.txt`):

```bash
cd Software
python pipeline/prepare_zone.py --zone mercadante     # pacchetto zona e controlli automatici
node pipeline/fetch/osm.js --zone mercadante          # strade e acqua da OpenStreetMap
node pipeline/barriers.js --zone mercadante           # layer delle barriere
```

Dove trovare i dati grezzi e come sono trattati: [«Dati grezzi»](https://app.notion.com/p/41a42c7f043f815aa9bae3b5db73b15a) su Notion.

## Limiti dichiarati

Fuoco di superficie (niente fuoco di chioma né salto di faville); vento e umidità uniformi sulla zona (un punto meteo); 13 modelli di combustibile di Anderson; barriere assolute; nessun incendio storico documentato a Mercadante per una validazione diretta. Elenco completo in [`PROBLEMI_NOTI.md`](https://app.notion.com/p/41a42c7f043f8139a956ebc089a7d27c).

## Dati e attribuzioni

TINITALY 1.1 (INGV, CC BY 4.0) · CORINE Land Cover 2018 (© Unione Europea, Copernicus Land Monitoring Service, EEA) · Copernicus Sentinel-2 · © OpenStreetMap contributors (ODbL) · Weather data by Open-Meteo.com (CC BY 4.0). Dettagli in [`Software/data/LICENZE_DATI.md`](Software/data/LICENZE_DATI.md).
