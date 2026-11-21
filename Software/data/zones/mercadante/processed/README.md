# processed

Pacchetto della zona letto dal motore: una matrice `.npy` per layer (600 × 600 celle da 10 m, UTM 33N, righe da Nord) + `manifest.json` con griglia, unità, fonti ed esito dei controlli. Incluso nel repository (licenze in `../../LICENZE_DATI.md`); non modificare a mano.

- `elevation`, `slope`, `aspect`, `tan_slope`, `ndvi`, `clc`, `fuel`, `quicklook.png`: generati da `pipeline/prepare_zone.py`.
- `barriers`: generato da `pipeline/barriers.js` (OpenStreetMap). Da rilanciare dopo ogni `prepare_zone.py`, che riscrive il manifest.
- `geotiff/` (escluso da git): copie per QGIS da `pipeline/export_geotiff.py`.
