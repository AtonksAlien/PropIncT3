# frontend (React + Vite + Leaflet)

Interfaccia web: mappa con il combustibile, inneschi con un clic, scelta del meteo (data in ora italiana con la fonte indicata, oppure vento costante), simulazione sul server via Socket.io, riproduzione animata con selettore di velocità, legenda delle isocrone, lettura della cella sotto il puntatore.

```bash
cd Software/frontend && npm install && npm run build    # crea dist/, servita dal backend
cd ../backend && npm start                               # demo su http://localhost:3001

npm run dev        # sviluppo con ricarica automatica (porta 5173, inoltra /api e /socket.io alla 3001)
```

| File | Compito |
| --- | --- |
| `src/App.jsx` | Stato dell'interfaccia, mappa Leaflet, controlli, Socket.io, riproduzione |
| `src/GridLayer.js` | Strato Leaflet che disegna una griglia UTM con una trasformazione affine |
| `src/paint.js` | Colori e disegno in `ImageData`: combustibile, isocrone, fronte attivo, barriere |
| `src/time.js` | Ora italiana ↔ UTC (indipendente dal fuso del computer); fonte meteo prevista per una data |
| `vite.config.js` | Proxy verso il backend in sviluppo; accesso a `../engine` |

Dal motore il browser riusa `engine/npy.js` (lettura del layer combustibile) e `engine/grid.js` + `engine/geo.js` (clic in lat/lon → cella, con la proiezione UTM esatta): lo stesso codice testato in `tests/engine/`.

## Scelte e perché

- **Un solo canvas per strato.** Ogni griglia (600 × 600 = 360 000 celle) è un'immagine `ImageData` disegnata in un canvas: ridisegnarla a ogni fotogramma costa pochi millisecondi. Il prototipo creava un rettangolo per cella.
- **Griglia UTM ruotata sulla mappa.** Leaflet usa Web Mercator; la griglia UTM a Mercadante è ruotata di circa 1,1° rispetto ai meridiani. `L.imageOverlay` (sempre allineato ai meridiani) sposterebbe i bordi fino a circa 60 m. `GridLayer` disegna invece l'immagine con la trasformazione affine dei 3 angoli NO, NE, SO forniti dal server (`corners_wgs84`): su 6 km la differenza tra UTM e Mercator è affine a meno di frazioni di metro. Celle nette (`imageSmoothingEnabled = false`).
- **Riproduzione lato client.** Il server invia una volta sola il tempo di arrivo di ogni cella; il browser mostra l'istante t colorando le celle con arrivo ≤ t (isocrone orarie, fronte attivo se acceso da meno di 10 minuti). Scorrere avanti e indietro non richiede nuovi calcoli. Velocità: 5–120 minuti simulati al secondo.
- **Validazione immediata degli inneschi.** Un clic fuori zona o su una cella non combustibile viene rifiutato subito nel browser, con un messaggio; il server ripete comunque il controllo.
- **Ora italiana esplicita.** La data dell'innesco è in ora italiana (CET/CEST) e convertita in UTC con `Intl`, anche se la pagina è aperta da un computer con un altro fuso.
- **Data controllata prima dell'invio.** Sotto la data compare la fonte che il server userà (archivio ECMWF IFS, ERA5 prima del 2017, ICON-2I per gli ultimi giorni e la previsione), con la stessa regola del backend; una data oltre i 2 giorni di previsione disattiva «Simula» con un messaggio. «Adesso» imposta l'ora attuale.
- **Lettura della cella.** Passando con il mouse si vedono riga, colonna, combustibile, eventuale barriera e tempo di arrivo nella cella.
- **Barriere OSM (giorno 12).** Strade asfaltate (grigio scuro), piste e sentieri (marrone) e acqua (blu) si vedono sopra il combustibile; la casella «Strade asfaltate e acqua fermano il fuoco» (attiva di default) le rende non combustibili. Un innesco su una barriera attiva viene rifiutato con un messaggio; la lettura della cella mostra il tipo di barriera.
- **Mappa sempre a misura.** Un `ResizeObserver` avvisa Leaflet quando il pannello cambia dimensione (prima la mappa restava tagliata).

## Verifica nel browser (9 nov 2026)

- Il combustibile si sovrappone alla mappa OpenStreetMap: la pineta coincide con la "Foresta Mercadante", l'area urbana a nord-est con gli edifici; il riquadro della zona appare leggermente ruotato, come atteso.
- 25/07/2023 ore 13, innesco nelle stoppie (r478 c204): calcolo 2,8 s, riproduzione con orario locale, 206 ha nella prima ora; il fuoco riempie la radura e rallenta al bordo della pineta.
- Nessun errore nella console del browser né nei log del server.

## Verifica nel browser (17 nov 2026, modello unico)

- Dualchi, vento costante 6 m/s da 240°, innesco nell'erba (r487 c400): calcolo 0,1 s; 79,9 ha nella prima ora, poi il fuoco si ferma contro strade asfaltate e fiume (114,2 ha a 3 ore). Pannello del risultato con area per ora e campi di Rothermel calcolati; nessun errore nella console oltre ai riquadri OSM bloccati nella prova senza rete.
