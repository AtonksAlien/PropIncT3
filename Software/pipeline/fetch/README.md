# pipeline/fetch

Script di download, uno per fonte. Scrivono in `data/zones/<zona>/raw/<fonte>/`.

| Script | Fonte |
| --- | --- |
| `osm.js` | Strade, ferrovie e acqua dall'API Overpass di OpenStreetMap (`node pipeline/fetch/osm.js --zone mercadante`) |

Il meteo si scarica da solo quando serve (`backend/src/weather/openmeteo.js`, con cache in `raw/meteo/`). DEM, CORINE e Sentinel-2 si scaricano a mano: fonti e istruzioni in [«Dati grezzi»](https://app.notion.com/p/41a42c7f043f815aa9bae3b5db73b15a) su Notion.
