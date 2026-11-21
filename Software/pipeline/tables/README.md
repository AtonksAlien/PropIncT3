# pipeline/tables

Tabelle di conversione in CSV:
- `corine_legend.csv` — indice raster 1–44 → codice CLC a 3 cifre → descrizione
- `corine_to_fuel.csv` — codice CLC → modello di combustibile **Anderson 13** (0 = non combustibile)
- `fuel_models.csv` — parametri dei 13 modelli di Anderson (carichi, superficie/volume, spessore, umidità di estinzione)

`corine_legend.csv` è una **bozza** con la numerazione standard CLC 2018 (indice 1–44 in ordine di codice): verificarla con la legenda inclusa nel pacchetto scaricato da CLMS. La colonna `presente_mercadante` segna le 13 classi trovate nel raster attuale.

`corine_to_fuel.csv` — scelti i 13 modelli di Anderson al posto dei 40 di Scott & Burgan per i tempi del progetto: parametri pochi e ben documentati, usati da FARSITE/BehavePlus. Le classi non elencate valgono 0. Correzione con NDVI: in bosco (8, 9, 10) le celle con NDVI < 0,2 diventano radura (modello 1).

## `fuel_models.csv` — unità e fonte

I valori sono riportati **nelle unità originali** (sistema anglosassone), così si confrontano riga per riga con la fonte; la conversione in SI avviene nel motore (`engine/fuels.js`).

| Colonna | Significato | Unità |
| --- | --- | --- |
| `w_1h`, `w_10h`, `w_100h` | Carico di combustibile morto per classe di diametro (< 0,6 cm, 0,6–2,5 cm, 2,5–7,6 cm) | t/acre (1 t/acre = 0,2242 kg/m²) |
| `w_live_herb`, `w_live_woody` | Carico vivo erbaceo e legnoso | t/acre |
| `sav_1h`, `sav_live_*` | Rapporto superficie/volume delle particelle | 1/ft (1/ft = 3,281 1/m) |
| `depth` | Spessore dello strato di combustibile | ft (1 ft = 0,3048 m) |
| `mx_dead` | Umidità di estinzione del combustibile morto | % |

Costanti comuni a tutti i modelli: superficie/volume 10h = 109 1/ft, 100h = 30 1/ft; potere calorifico 8 000 BTU/lb (18 608 kJ/kg); densità delle particelle 32 lb/ft³ (513 kg/m³); contenuto minerale totale 5,55%, effettivo 1%.

**Fonte:** Anderson H. E. (1982). *Aids to determining fuel models for estimating fire behavior.* USDA Forest Service, Gen. Tech. Rep. INT-122, Tabella 1. Gli stessi valori sono ripresi in Scott J. H., Burgan R. E. (2005), RMRS-GTR-153, Tabella 3 (modelli "originali 13"), e in Andrews P. L. (2018), RMRS-GTR-371. Il carico vivo del modello 2 è erbaceo; quello dei modelli 4, 5, 7 e 10 è legnoso.

Modelli usati a Mercadante: 1 (seminativi, prati, oliveti), 2 (agricolo con vegetazione naturale), 6 (arbusteto in evoluzione), 8 (bosco misto), 9 (latifoglie), 10 (pineta di rimboschimento).
