# FlamMap 6 — Incendio di Siniscola (Nuoro), 28–29 luglio 2019 — Copernicus EMS EMSR374

File preparati da `validation/flammap_prep.js` con i dati di PropInc. Sistema di riferimento: EPSG:32632
(WGS 84 / UTM 32N), celle da 10 m, 800 × 800.

## Valori da inserire

| Parametro | Valore |
| --- | --- |
| Vento a 20 ft (6,1 m) | **11 mph @ 20'** (FlamMap accetta solo interi; vento medio a 10 m 5.58 m/s, cioè 10.8 mph a 20 ft) |
| Direzione di provenienza del vento | **275°** (gradi da Nord, da dove soffia) |
| Umidità | file `umidita.fms`: 1h 11%, 10h 10%, 100h 11%, erbacee 30%, legnose 60% |
| Condizionamento delle umidità | nessuno (umidità fisse del file .fms) |
| Innesco | `innesco.shp` (x 553795.0, y 4486215.0) |
| Durata MTT | **1440 minuti** |
| Risoluzione MTT | **10 m** |
| Probabilità di focolai secondari (spotting) | **0** |
| Fuoco di chioma | spento (CBD = 0 nel paesaggio) |

Vento e umidità sono le medie dei primi 360 minuti dopo l'innesco (2019-07-28T19:05:00.000Z), meteo Open-Meteo
ecmwf_ifs, punto 40.5274, 9.6494.

## Passi

1. **Paesaggio.** In FlamMap: *File → Create Landscape* (in alcune versioni *Landscape → Generate LCP*).
   Assegna i temi: Elevation = `elevation.asc` (metri), Slope = `slope.asc` (gradi), Aspect = `aspect.asc` (gradi),
   Fuel Model = `fuel.asc` (13 modelli di Anderson; 99 = non combustibile), Canopy Cover = `cover.asc` (percento),
   Stand Height = `height.asc` (metri), Canopy Base Height = `cbh.asc` (metri), Canopy Bulk Density = `cbd.asc` (kg/m³).
   Salva come `paesaggio.lcp` in questa cartella e aprilo (*File → Open Landscape*).
2. **Run.** *Analysis Area → New Run* (o tasto destro su *Runs*). Scheda *Model Inputs*: carica `umidita.fms`;
   vento: *Constant* con velocità e direzione della tabella; condizionamento: nessuno.
3. **MTT.** Scheda *Minimum Travel Time*: ignizione da file = `innesco.shp`; durata 1440 min; risoluzione 10 m;
   spot probability 0; tutti i processori. Avvia (*Launch*).
4. **Uscita.** Al termine, nella lista delle uscite: tasto destro su *Arrival Time* → *Export* → griglia ASCII.
   Salvala come `risultati/arrivo_flammap.asc` in questa cartella. Fai lo stesso, se vuoi, per *Rate of Spread*.
5. **Facoltativo (vento sul terreno).** Ripeti il run con *Gridded Winds → WindNinja* (stessa velocità e direzione,
   risoluzione del vento 50 m) e salva l'arrivo come `risultati/arrivo_flammap_windninja.asc`.

Poi carica su GitHub (push) i file di `risultati/`. Il confronto si fa con:

```
node validation/validate.js --case siniscola-2019-flammap
node validation/temporal.js --case siniscola-2019 --arrivo data/zones/siniscola/flammap/siniscola-2019/risultati/arrivo_flammap.asc --unita min --nome flammap --riferimento data/zones/siniscola/validation/siniscola-2019-flammap/arrivo.npy
```

Il primo simula con PropInc gli stessi ingressi semplificati (config/validation/siniscola-2019-flammap.json).
Il secondo misura FlamMap contro l'incendio reale (ad area uguale e passaggio per passaggio) e contro quella
simulazione di PropInc cella per cella: con ingressi identici la differenza misura l'implementazione, non i dati.
