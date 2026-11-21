# tests

`npm test` (da `Software/`) esegue i test di motore e pipeline; `npm run test:all` anche quelli del server. Usano `node:test`, senza dipendenze. I test che richiedono il pacchetto della zona o la cache meteo si saltano da soli se i file mancano (nel repository ci sono).

| File | Cosa verifica |
| --- | --- |
| `engine/engine.test.js` | Lettura `.npy`, tabella dei combustibili, caricamento del pacchetto, confronto tra due mappe di arrivo |
| `engine/weather.test.js` | Interpolazione oraria e direzione sul cerchio, EMC di Simard, costanti di tempo 1h/10h/100h, pioggia, scelta della fonte Open-Meteo, cache (fetch finto, niente rete) |
| `engine/rain.test.js` | Simulazione con pioggia dall'innesco e dopo 2 ore (il fronte si ferma entro circa un'ora); limite dichiarato: dopo una pioggia breve il fronte non riparte |
| `engine/rothermel.test.js` | 16 valori di riferimento della libreria Behave (US Forest Service) entro 10⁻⁶, parametri Anderson contro Behave, effetti di vento, pendenza e umidità |
| `engine/mtt.test.js` | Ellisse contro Behave (4 valori), coda di priorità, cerchio senza vento (errore ≤ 2,7%), ellisse con vento, indipendenza dal passo, barriere dritte e diagonali, campo su richiesta identico al campo completo |
| `engine/geo.test.js` | Proiezione UTM contro valori noti e contro PROJ (angoli della zona), andata e ritorno sotto il millimetro |
| `validation/validation.test.js` | Perimetro → celle (UTM, WGS84, buchi, filtro, bordi), metriche contro valori calcolati a mano, area uguale, cerchio ed ellisse, punti caldi FIRMS, valutazione con l'osservato uguale al modello (Sørensen 1) |
| `pipeline/barriers.test.js` | Rasterizzazione "tutte le celle toccate" (anche contro 200 linee casuali), poligoni, classificazione OSM, scrittura `.npy`, strade che fermano il fuoco e piste che non lo fermano |
| `../backend/test/server.test.js` | REST e Socket.io end-to-end: zone e layer, risultato binario, meteo, richieste non valide, annullamento, client indipendenti |

Il benchmark non è un test: `npm run bench` (`experiments/bench.js`). La pipeline Python (`prepare_zone.py`) ha i suoi controlli automatici integrati (`pipeline/checks.py`), il cui esito è nel `manifest.json`.
