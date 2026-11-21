# engine (JavaScript puro)

Cuore della simulazione, senza dipendenze esterne: gira in Node e nel browser e si testa da solo.

```bash
cd Software
npm test                                                                 # test del motore
node engine/cli.js --date 2023-07-25T13:00+02:00 --hours 3 --png out/s.png   # meteo reale
node engine/cli.js --wind 6@270 --hours 2 --png out/c.png                    # vento costante
node engine/cli.js --date 2023-07-25T13:00+02:00 --ros out/r.png             # + mappa velocità di Rothermel
```

Opzioni della CLI: `--zone` (default `mercadante`), `--ignite "E,N"` in UTM 33N oppure `"r:c"` (più inneschi separati da `;`; default centro della pineta), `--wind velocità@provenienza` (m/s, gradi da Nord, convenzione meteo), `--date` (istante dell'innesco in ISO 8601: vento e umidità reali da Open-Meteo, al posto di `--wind`), `--ros` (mappa della velocità di Rothermel all'innesco e tabella per combustibile), `--hours`, `--png`. Senza `--date` l'umidità è lo scenario D2L2 di Scott & Burgan (6/7/8% morti, 60/90% vivi).

| File | Stato | Compito |
| --- | --- | --- |
| `npy.js` | ✅ | Lettura dei `.npy` di NumPy in `TypedArray` (da `ArrayBuffer`: Node e browser) |
| `grid.js` | ✅ | Pacchetto zona in memoria, griglie sintetiche per i test, conversione UTM/lat-lon → cella |
| `load-node.js` | ✅ | Lettura del pacchetto dal disco (solo Node) |
| `fuels.js` | ✅ | Modelli Anderson 13 da `pipeline/tables/fuel_models.csv`, convertiti in SI |
| `render.js`, `png.js` | ✅ | Immagine del tempo di arrivo con isocrone orarie |
| `simulate.js` | ✅ | Una simulazione completa (meteo → campo di Rothermel → tempo di arrivo): usata da CLI, worker del server, esperimenti e validazione. `job`: `barriers`, `liveNdvi`, `terrainWind` (`{ method: 'massa', blhM }`, `{ method: 'campo', runs }` o `true` per MicroMet), `fuelNdvi`; il meteo può portare l'altezza oraria dello strato limite (`blhJson`, ERA5) |
| `grid.js` · `withBarriers` | ✅ | Barriere OSM (giorno 12): strade asfaltate, ferrovie e acqua del layer `barriers` diventano non combustibili; con il layer `barrier_width` il fronte le salta se la fascia è più stretta di 2 × lunghezza di fiamma (+4 m oltre 5 m/s), calcolata con la raffica (D46). `job.barriers`: `true` attraversabili, `'assolute'`, `false` |
| `geo.js` | ✅ | Proiezione UTM esatta (serie di Krüger): lat/lon ↔ griglia |
| `cli.js` | ✅ | Simulazione da riga di comando |
| `weather.js` | ✅ | Serie oraria → valori al minuto; umidità del combustibile morto (1h, 10h, 100h) e vivo |
| `rothermel.js` | ✅ | Rothermel (1972) + Albini (1976): velocità e direzione massima, vento efficace, fattore di riduzione del vento |
| `spreadfield.js` | ✅ | Rothermel su tutta la griglia per un istante (`spreadField`) o cella per cella su richiesta (`LazyField`, giorno 11: simulazione 20 volte più veloce); calore per unità di area e lunghezza di fiamma di Byram; umidità viva per cella dall'NDVI in 5 classi di verde relativo (`liveNdvi`, D47) |
| `ellipse.js` | ✅ | Ellisse di Anderson (1983): rapporto lunghezza/larghezza, velocità in ogni direzione |
| `heap.js` | ✅ | Coda di priorità (min-heap) su `TypedArray` |
| `mtt.js` | ✅ | Tempo minimo di arrivo con Dijkstra su 16 direzioni, con salto delle barriere attraversabili (D46) |
| `masswind.js` | ✅ | Vento a conservazione della massa in uno strato tra suolo e cima dello strato limite (D53, default della validazione): ∇·(h∇λ) = −∇·(h u₀) risolto per sovrarilassamento su una griglia a 50 m; verificato contro WindNinja 4.0 a Siniscola |
| `terrainwind.js` | ✅ | Correzione empirica MicroMet (Liston & Elder 2006; D52): provata, non adottata |
| `windfield.js` | ✅ | Campo di vento esterno dalle griglie ASCII di WindNinja (velocità in mph se la configurazione non dice altro) |
| `fuelndvi.js` | ✅ | Combustibile a 10 m dall'NDVI estivo di prima dell'evento con la soglia di Otsu (D54): opzione, non adottata (migliora Siniscola, peggiora Dualchi) |

## Convenzioni (valide per tutto il motore)

- Cella `i = r * cols + c`; riga 0 = Nord, colonna 0 = Ovest; lato 10 m.
- Vento in ingresso come in meteorologia: **direzione da cui proviene**, gradi da Nord in senso orario (270° = da Ovest → il fuoco va verso Est).
- Esposizione (`aspect`): direzione verso cui il versante **scende**.
- Uscita: `arrival` (`Float32Array`, minuti dall'innesco, `Infinity` = non raggiunta).

## Meteo (`weather.js` + `backend/src/weather/openmeteo.js`)

| Passo | Metodo | Fonte |
| --- | --- | --- |
| Download | Open-Meteo, punto meteo della zona, tutto in UTC e m/s. Passato oltre 7 giorni: archivio ECMWF IFS (9 km, dal 2017; ERA5 prima). Ultimi giorni e prossimi 2: ICON-2I (2,2 km) | open-meteo.com |
| Cache | Un JSON per richiesta in `data/zones/<zona>/raw/meteo/`; archivio valido per sempre, previsione per 1 ora | — |
| Al minuto | Interpolazione lineare tra le ore. La direzione si interpola su seno e coseno (tra 350° e 10° la media è 0°), la velocità a parte | — |
| Equilibrio (EMC) | Formula di Simard da temperatura e umidità dell'aria | Simard 1968; NFDRS, Bradshaw et al. 1984 |
| Umidità morta | Tempo di ritardo: ogni classe tende all'EMC con τ = 1, 10, 100 h; ora con pioggia ≥ 0,5 mm → tende al 35%. La serie parte 3 giorni prima dell'innesco | Byram 1963; Fosberg 1970 |
| Umidità viva | Scenari L1–L4; scelta per mese (lug–set L1, giu/ott L2, altrimenti L3: assunzione nostra) | Scott & Burgan 2005, Tab. 6 |

Esempio (25 luglio 2023, 13:00 locali, ondata di calore in Puglia): 40 °C, umidità relativa 14%, vento 7,6 m/s da 239°; umidità morta 1h 3,2% · 10h 5,7% · 100h 6,7%.

**Limiti:** vento e umidità uniformi sulla zona (un solo punto meteo); temperatura e umidità a 2 m, non al livello del combustibile (niente correzione per sole e ombra); la classe 100h conserva in parte la condizione iniziale.

## Rothermel (`rothermel.js`, `spreadfield.js`)

Equazioni di Rothermel (1972) con le modifiche di Albini (1976), scritte nelle **unità originali** (lb, ft, BTU, min) per confrontare ogni coefficiente con la fonte; SI solo in ingresso e in uscita. Il calcolo segue l'organizzazione di Behave/BehavePlus:

1. `fuelbed(modello, umidità)`: carichi e superfici per classe (pesi per classe di dimensione di Albini), umidità di estinzione viva, intensità di reazione I_R, flusso propagante ξ, calore di preaccensione, **R0** (senza vento né pendenza), coefficienti del vento C, B, E. Con umidità uniforme sulla zona si calcola una volta per modello.
2. `spread(letto, vento a metà fiamma, verso del vento, pendenza, esposizione)`: φ_w = C·U^B·(β/β_op)^−E, φ_s = 5,275·β^−0,3·tan²θ, **somma vettoriale** di vento (verso cui soffia) e pendenza (verso monte) → velocità massima e direzione; vento efficace per l'ellisse.
3. Vento a metà fiamma: vento a 10 m ÷ 1,15 (→ 20 ft) × WAF di Albini & Baughman (1979): scoperto in base allo spessore del combustibile; sotto chioma per i modelli 8–10, con copertura 50%, altezza 12 m, crown ratio 0,5 (**assunzione** per la pineta, da sottoporre a sensibilità).
4. Limite del vento (0,9·I_R) disponibile ma spento di default, come in Behave (Andrews et al. 2013).

**Verifica.** `tests/engine/rothermel.test.js` riproduce **16 valori di riferimento** dei test ufficiali di Behave (US Forest Service, base di BehavePlus): velocità con vento e pendenza in 6 combinazioni (modelli GS4 e FM4), SAV caratteristico, umidità di estinzione viva, umidità pesate, sorgente di calore, e i 5 valori del test sul limite del vento (FM1). Tutti coincidono **entro 10⁻⁶** (10⁻² per il limite, come nell'originale).

Esempio, 25 luglio 2023 ore 13 (vento 7,6 m/s da 239°, umidità morta 1h 3,2%, viva L1):

| Modello | Celle | WAF | R0 (m/min) | Velocità mediana (m/min) | Massima (m/min) |
| --- | --- | --- | --- | --- | --- |
| 1 — erba bassa (seminativi, prati) | 183 167 | 0,36 | 1,74 | 44,5 | 58,5 |
| 2 — erba sotto copertura rada | 16 005 | 0,36 | 1,19 | 20,8 | 23,6 |
| 8 — lettiera compatta | 3 884 | 0,16 | 0,10 | 0,4 | 0,4 |
| 9 — lettiera di latifoglie | 3 902 | 0,16 | 0,37 | 1,4 | 1,5 |
| 10 — pineta con sottobosco | 133 468 | 0,16 | 0,42 | 1,8 | 5,0 |

Le stoppie corrono circa 25 volte più della pineta: combustibile fine e secco, esposto al vento pieno; sotto le chiome il vento a metà fiamma è meno della metà. È un comportamento noto dei modelli di Anderson (fuoco di superficie; il fuoco di chioma non è modellato: limite dichiarato).

## Propagazione — Rothermel + ellisse + tempo di arrivo (`mtt.js`)

1. **Velocità in ogni direzione.** In ogni cella Rothermel dà velocità massima, direzione e vento efficace U; l'ellisse di Anderson (1983) dà il rapporto lunghezza/larghezza LW = 0,936·e^(0,1147·U) + 0,461·e^(−0,0692·U) − 0,397 (U in mi/h, massimo 8) e l'eccentricità e. Con l'innesco nel fuoco dell'ellisse: R(β) = R_max·(1 − e)/(1 − e·cos β).
2. **Tempo di arrivo.** La griglia è un grafo con 16 vicini per cella (8 adiacenti + 8 a salto di cavallo). Passare da i a j (distanza d, azimut θ) costa (d/2)/R_i(θ) + (d/2)/R_j(θ). Dijkstra estrae sempre la cella più vicina nel tempo, con una coda di priorità su `TypedArray`: quando una cella esce dalla coda il suo tempo è definitivo (Finney 2002, metodo di FlamMap).
3. **Barriere.** Un passo diagonale o a salto di cavallo è permesso solo se anche le celle attraversate bruciano: una strada o una fascia larga una cella non si scavalca, nemmeno in diagonale.
4. **Meteo variabile.** Il campo di Rothermel si ricalcola ogni 10 minuti simulati (vento e umidità interpolati); ogni passo usa il campo dell'istante in cui la cella di partenza si accende.

**Perché 16 direzioni.** Con 8 il fronte è un ottagono: errore sulle distanze fino a 1/cos 22,5° − 1 = 8,2%. Con 16 le direzioni distano al più 26,6° e il limite teorico è 1/cos 13,3° − 1 = 2,7%.

**Verifica** (`tests/engine/mtt.test.js`, traguardo M3):

| Prova | Atteso | Misurato |
| --- | --- | --- |
| LW e velocità in 3 direzioni qualsiasi (Behave, GS4) | 1,375624 · 4,180938 · 3,438243 · 2,944975 | identici entro 10⁻⁶ |
| Cerchio senza vento, 72 direzioni a 1 km | errore ≤ 2,7% | massimo **2,70%**, medio 1,43% |
| Ellisse, vento 10 m/s, testa a 140 celle | testa 140, coda 10,2 celle, LW 1,986 | testa 140, coda 10, L/W 2,013 |
| Velocità raddoppiate | tempi dimezzati (nessun passo di tempo) | sì, entro 10⁻³ |
| Fascia di 1 cella, dritta e diagonale | invalicabile | invalicabile |

Prestazioni (aggiornate al giorno 11): griglia 600 × 600 interamente bruciata in circa 0,26 s di Dijkstra; con meteo reale su 3 ore circa 0,15 s grazie al campo di Rothermel calcolato su richiesta (`LazyField`; prima 2,7 s, quasi tutti per ricalcolare il campo su tutta la griglia ogni 10 minuti). Tempo e memoria fino a 2000² celle in [«Benchmark»](https://app.notion.com/p/41a42c7f043f81d5bd58c693dc0bb49a) su Notion.

## Test (`tests/engine/`)

`geo.test.js`: proiezione UTM contro valori noti e contro PROJ (angoli della zona entro 10⁻⁶°), andata e ritorno sotto il millimetro.

`mtt.test.js`: ellisse contro Behave (4 valori); coda di priorità; cerchio senza vento; ellisse con vento; indipendenza dal passo di tempo; barriere dritte e diagonali; salita.

`rothermel.test.js`: 16 valori di riferimento di Behave; parametri di `fuel_models.csv` contro i record di Behave; direzione con solo vento / sola pendenza; effetto dell'umidità ed estinzione; fattore di riduzione del vento.

`weather.test.js`: interpolazione e direzione sul cerchio; EMC con valore di riferimento; costanti di tempo 1h/10h/100h; pioggia; scelta della fonte; cache (con un fetch finto, senza rete).

`engine.test.js`: lettura `.npy`; tabella dei combustibili; caricamento del pacchetto Mercadante; confronto tra due mappe di arrivo.

`terrainwind.test.js`, `masswind.test.js` (in piano nessuna correzione; flusso conservato: divergenza 190 volte più piccola; incanalamento in valle più forte con lo strato basso), `windfield.test.js` (griglie ASCII, interpolazione, unità), `fuelndvi.test.js` (soglia di Otsu, regole di riclassificazione, barriere sul combustibile corretto).
