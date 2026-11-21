# Dati inclusi nel repository e loro licenze

Nel repository c'è il **pacchetto della zona di Mercadante** (`zones/mercadante/processed/`, circa 10 MB), così la demo si avvia subito dopo un clone, e la serie meteo del 25 luglio 2023 (`zones/mercadante/raw/meteo/`, pochi kB). I dati grezzi non ci sono: si scaricano seguendo [«Dati grezzi»](https://app.notion.com/p/41a42c7f043f815aa9bae3b5db73b15a) su Notion e si rielaborano con `pipeline/`.

Ogni layer del pacchetto è un **prodotto derivato** (riproiettato a 10 m in UTM 33N, ritagliato, trasformato) dalle fonti seguenti, ciascuna con la propria licenza e attribuzione.

| File | Fonte | Licenza e attribuzione |
| --- | --- | --- |
| `elevation.npy`, `slope.npy`, `aspect.npy`, `tan_slope.npy` | TINITALY 1.1, INGV | CC BY 4.0. Tarquini S., Isola I., Favalli M., Battistini A., Dotta G. (2023). *TINITALY, a digital elevation model of Italy with a 10 meters cell size* (Version 1.1). INGV. https://doi.org/10.13127/tinitaly/1.1 |
| `clc.npy`, `fuel.npy` | CORINE Land Cover 2018 (Copernicus Land Monitoring Service) | Accesso libero e gratuito con attribuzione: © European Union, Copernicus Land Monitoring Service 2018, European Environment Agency (EEA). `fuel.npy` contiene anche la tabella di conversione del progetto (`pipeline/tables/`) e la correzione con l'NDVI |
| `ndvi.npy` | Sentinel-2 L2A del 5 settembre 2026 (Copernicus), immagine NDVI del Copernicus Browser invertita | Contains modified Copernicus Sentinel data [2026], processed by Sentinel Hub |
| `barriers.npy` | OpenStreetMap (API Overpass, 10/11/2026) | © OpenStreetMap contributors. Banca dati derivata, distribuita con la licenza **Open Database License (ODbL) 1.0**: https://opendatacommons.org/licenses/odbl/ |
| `manifest.json`, `quicklook.png` | Progetto PropInc | Descrizione della griglia, fonti ed esito dei controlli; anteprima |
| `raw/meteo/ecmwf_ifs_2023-07-22_2023-07-25_…json` | Open-Meteo, modello ECMWF IFS | CC BY 4.0: Weather data by Open-Meteo.com, modello ECMWF IFS (dati aperti ECMWF, CC BY 4.0) |

**Nota.** Le condizioni di licenza sono state riassunte dalle pagine delle fonti consultate durante il progetto ([«Fonti esterne»](https://app.notion.com/p/41a42c7f043f815faa63db0b40b6687f) su Notion); prima della consegna verificarle sulle pagine ufficiali, in particolare per CORINE e Sentinel (politica dati Copernicus) e per l'ODbL dei dati OpenStreetMap.
