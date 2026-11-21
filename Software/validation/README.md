# validation — confronto con incendi reali

Misura quanto l'incendio simulato somiglia a uno vero: area bruciata osservata (perimetro) e, se ci sono, i punti caldi dei satelliti con l'ora del passaggio.

```bash
cd Software
node validation/validate.js esempio-mercadante      # esempio sintetico incluso (0,4 s, senza rete)
node validation/validate.js dualchi-2019            # caso reale (Dualchi, 6 agosto 2019)
node validation/validate.js siniscola-2019 --ensemble 50   # secondo caso (Siniscola, 28 luglio 2019)
node validation/windninja_compare.js siniscola      # confronto tra il vento di WindNinja e il nostro
```

Opzioni:

| Opzione | Effetto |
| --- | --- |
| `--ensemble 50` | Insieme di simulazioni con innesco (dentro l'area osservata), ora e vento perturbati: mappa `probabilita.png`, mediana e quartili del Sørensen (D48, D51) |
| `--barriers on\|off\|assolute` | Barriere attraversabili secondo la lunghezza di fiamma (default), nessuna, o ogni strada ferma il fuoco |
| `--vento-terreno massa\|massa:<m>\|windninja\|<η>\|off` | Vento sul rilievo: conservazione della massa con lo strato limite orario di ERA5 (default, D53), con uno strato fisso, griglie di WindNinja (`data/zones/<zona>/windninja/out`), MicroMet con scala η (D52), oppure vento uniforme |
| `--combustibile-ndvi on\|off` | Combustibile corretto a 10 m dall'NDVI di prima dell'evento (D54, default off) |
| `--live-ndvi on\|off` | Umidità viva per cella dall'NDVI (default on, D47) |
| `--out <nome>` | Cartella dei risultati (per non sovrascrivere quelli ufficiali) |
| `--tol 60` | Tolleranza in minuti sui punti caldi |

Uscita in `data/zones/<zona>/validation/<caso>/` (esclusa da git, si rigenera):

| File | Contenuto |
| --- | --- |
| `rapporto.md` | Dati del caso, tabelle dei risultati, come leggerli |
| `metriche.json` | Tutti i numeri |
| `confronto.png` | Verde = in comune, blu = bruciata ma non simulata, arancio = simulata ma non bruciata, nero = innesco |
| `punti_caldi.csv` | Per ogni passaggio del satellite: ora, arrivo simulato, errore, esito |
| `arrivo.npy` | Tempo di arrivo simulato in minuti (float32, righe × colonne, `inf` = mai) |
| `temporale.md`, `temporale.json`, `temporale_passaggi.csv` | Confronto nel tempo, passaggio per passaggio (vedi sotto); con `--ensemble` anche mediana e quartili dell'insieme |

## Che cosa misura

1. **Forma, ad area uguale.** Ogni modello è fermato quando ha bruciato la stessa area combustibile dell'incendio vero. Così l'ora di fine, spesso incerta per lo spegnimento, non conta: si misura solo *dove* è andato il fuoco.
2. **Area e forma alla fine osservata** (se il caso indica `observed_end`): qui pesa anche la velocità. Lo spegnimento non è simulato, quindi una sovrastima è attesa.
3. **Tempi**: un punto caldo FIRMS dice che nel pixel c'era fuoco all'ora del passaggio. Il fronte simulato deve esserci già arrivato: si conta quante volte arriva in ritardo.

4. **Nel tempo, passaggio per passaggio** (`lib/temporal.js`). All'ora t di ogni passaggio l'area osservata è l'unione dei pixel dei punti caldi fino a t, dentro il perimetro finale; quella simulata sono le celle con arrivo ≤ t. Si riportano il Sørensen tra le due, lo **sfasamento** (i minuti di cui spostare la simulazione per somigliare di più all'osservato: positivo = in ritardo) e il **ritardo** dei punti caldi, max(0, arrivo simulato − t), che è l'unico errore di tempo certo. Riferimento: il perimetro finale disegnato già a ogni ora.

   Lo stesso confronto per una mappa dei tempi di arrivo esterna (FlamMap, FARSITE in griglia ASCII nell'UTM della zona):

   ```
   node validation/temporal.js --case siniscola-2019 --arrivo percorso/arrival.asc --unita min --nome flammap
   ```

   Scrive anche `fine_incendio.json` con il Sørensen ad area uguale, confrontabile con quello di `validate.js`.

Le misure sono calcolate solo sulle celle combustibili: una strada dentro il perimetro non è un errore del modello.

| Misura | Formula | Significato |
| --- | --- | --- |
| Sørensen (Dice) | 2 VP / (2 VP + FP + FN) | Sovrapposizione: 100% = stesse celle. L'indice più usato in letteratura |
| Jaccard | VP / (VP + FP + FN) | Più severo |
| Precisione | VP / (VP + FP) | Parte della simulazione bruciata davvero |
| Recall | VP / (VP + FN) | Parte dell'incendio vero presa dal modello |
| Kappa di Cohen | (accordo − accordo casuale) / (1 − accordo casuale) | Dipende dalla dimensione della zona: solo per confronti sullo stesso caso |
| Miglioramento sull'ellisse | (S − S_ellisse) / (1 − S_ellisse) | 0% = come il riferimento ingenuo, 100% = perfetto, negativo = peggio |

VP = celle bruciate in entrambe, FP = solo simulate, FN = solo osservate.

**Riferimenti ingenui.** Un perimetro qualsiasi della dimensione giusta attorno all'innesco ottiene già un Sørensen discreto. Per questo il rapporto riporta anche un **cerchio** e l'**ellisse di Anderson orientata con il vento medio**: stessa area, nessuna conoscenza di combustibile e terreno. Il modello è utile se li batte.

## Descrivere un caso

Un file `config/validation/<caso>.json`. I percorsi sono relativi a `data/zones/<zona>/`.

| Campo | Obbligatorio | Significato |
| --- | --- | --- |
| `zone` | sì | Zona già preparata con la pipeline (`config/zones/<zona>.json`) |
| `name` | sì | Nome leggibile |
| `perimeter` | sì | GeoJSON dell'area bruciata, in WGS84 (EPSG:4326) oppure nello stesso UTM della zona |
| `perimeter_filter` | no | `{ "field": "...", "values": [...] }` per tenere solo alcuni elementi (es. alcuni gradi di danno) |
| `perimeter_source` | no | Fonte, riportata nel rapporto |
| `start` | sì | Ora dell'innesco, ISO 8601 con fuso, es. `2019-08-06T13:00+02:00` |
| `ignitions_wgs84` | no | `[[lat, lon], ...]`; se vuoto si usa il centro del primo passaggio FIRMS nella zona (incerto di qualche centinaio di metri) |
| `hours` | no (24) | Durata simulata: deve bastare a raggiungere l'area osservata |
| `observed_end` | no | Ora di fine osservata, per il confronto «a fine incendio» |
| `hotspots` | no | CSV di NASA FIRMS |
| `wind` | no | `{ "speed": m/s, "from": gradi }` per usare un vento costante invece del meteo reale |
| `barriers` | no (true) | Strade asfaltate e acqua da OSM fermano il fuoco |
| `synthetic` | no | `true` per un caso di prova: il rapporto lo dichiara |

Che dati scaricare per il caso di Dualchi e come prepararli: [«Dati di validazione»](https://app.notion.com/p/41a42c7f043f81d584f4caff491e80fe) su Notion.

## File

| File | Compito |
| --- | --- |
| `validate.js` | Comando: legge il caso, meteo (con cache), valutazione, rapporto e mappe |
| `lib/perimeter.js` | GeoJSON → celle della griglia (scansione per righe, buchi, più elementi, WGS84 o UTM) |
| `lib/metrics.js` | Matrice di confusione, indici, maschera ad area uguale |
| `lib/baselines.js` | Cerchio ed ellisse del vento medio con la stessa area |
| `lib/hotspots.js` | Lettura del CSV FIRMS e confronto con il tempo di arrivo |
| `lib/evaluate.js` | Esegue la simulazione e calcola tutto (funzione pura, usata anche nei test) |
| `lib/ensemble.js` | Insieme di simulazioni: perturbazioni di innesco (raggio `ignition_radius_m`), ora (`start_window_min`) e vento (±25%, ±20°), probabilità di bruciare (D48) |
| `lib/report.js` | Rapporto in Markdown |
| `lib/temporal.js`, `lib/temporal-report.js` | Confronto nel tempo per passaggio del satellite e sua scrittura |
| `temporal.js` | Comando: confronto nel tempo e ad area uguale di una mappa di arrivo qualsiasi (`.npy` o `.asc`) |
| `windninja_compare.js` | Confronto cella per cella tra le griglie di WindNinja e il vento a conservazione della massa; scrive `windninja/confronto.json` |

Test: `tests/validation/temporal.test.js` (3 casi: passaggi, ritardo, sfasamento) e `tests/validation/validation.test.js` (8 casi, tra cui "se l'osservato è il modello stesso, il Sørensen è 1").
