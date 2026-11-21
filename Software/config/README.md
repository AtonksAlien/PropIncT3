# config

Un file JSON per zona in `zones/`: area di analisi (AOI) in UTM 33N e in WGS84, risoluzione (10 m), margine di elaborazione (500 m, poi ritagliato), file grezzi di ingresso, data dell'immagine Sentinel-2 e punto meteo.
Pipeline, server e CLI leggono da qui: nessun percorso o coordinata scritti nel codice.
