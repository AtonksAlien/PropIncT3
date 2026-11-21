# pipeline (Python e JavaScript)

Trasforma i dati grezzi di una zona nel pacchetto letto dal motore.

```bash
pip install -r pipeline/requirements.txt matplotlib
python pipeline/prepare_zone.py --zone mercadante   # crea data/zones/mercadante/processed/
python pipeline/quicklook.py mercadante             # anteprima a 4 pannelli
node pipeline/fetch/osm.js --zone mercadante        # una volta: dati OpenStreetMap (Overpass)
node pipeline/barriers.js --zone mercadante         # dopo prepare_zone.py: aggiunge il layer barriers
python pipeline/export_geotiff.py mercadante        # GeoTIFF per QGIS
```

| File | Compito |
| --- | --- |
| `prepare_zone.py` | Griglia master UTM 10 m (fuso della configurazione: 33N a Mercadante, 32N in Sardegna), riproiezione, combustibile, ritaglio, controlli, `.npy` + `manifest.json` |
| `ndvi_palette.py` | Recupero dell'NDVI dall'immagine colorata del Copernicus Browser (inversione della palette Sentinel Hub) |
| `terrain.py` | Pendenza ed esposizione (Horn 3×3, azimut da Nord verso valle) |
| `checks.py` | Controlli automatici: CRS, risoluzione, quote, pendenze, NDVI, celle combustibili |
| `quicklook.py` | Immagine di controllo `processed/quicklook.png` |
| `fetch/osm.js` | Scarica strade, ferrovie e acqua del riquadro della zona dall'API Overpass di OpenStreetMap (cache in `raw/osm/overpass.json`) |
| `barriers.js` | Layer `barriers` (uint8) e `barrier_width` (metri; 255 = invalicabile) nel pacchetto: strade asfaltate, ferrovie e acqua con la loro larghezza (tag `width` o tipica della classe, D49), piste e sentieri (solo visualizzati); rasterizzazione "tutte le celle toccate" (`raster.js`). In JavaScript (DECISIONI D32) |
| `windninja_prep.py` | Ingressi per WindNinja: DEM del pacchetto in GeoTIFF, una configurazione per direzione del vento, script `esegui_windninja.ps1` (`python pipeline/windninja_prep.py siniscola 6 250:305:5`) |
| `export_geotiff.py` | Copia del pacchetto in GeoTIFF + mappe colori per la verifica in QGIS ([«Verifica in QGIS»](https://app.notion.com/p/41a42c7f043f81079991dbf8c261f1f9) su Notion) |
| `barriers.js` · larghezze | Layer `barrier_width` (m): tag OSM `width` o valore per classe (`WIDTH_BY_CLASS`: autostrada 30, superstrada 25, primaria 12, secondaria 9, terziaria 7, comunale 5, ferrovia 8, fiume 15; laghi e invasi invalicabili) |
| `edge_slope_check.py` | Pendenza nella fascia di bordo del bosco: misura le false scarpate del DSM |
| `tables/` | Legenda Corine e conversione in modelli di combustibile |
| `fetch/` | Download: `osm.js` (OpenStreetMap, Overpass); il meteo si scarica da solo dal server e dalla CLI |

Pacchetto prodotto (`processed/`): `elevation`, `slope`, `aspect`, `tan_slope`, `ndvi` (float32), `clc` (int16), `fuel` (uint8), più `manifest.json` con griglia, confini WGS84, unità, fonti ed esito dei controlli.
