// Rapporto di validazione in Markdown, in italiano, pronto da leggere o da copiare nella tesi.

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const num = (x, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d).replace('.', ','));
const hm = (m) => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`);

export function renderReport(info, r) {
  const k = info.kase, e = r.baselines.ellipse, w = e.wind;
  const row = (label, s) => `| ${label} | ${pct(s.sorensen)} | ${pct(s.jaccard)} | ${pct(s.precision)} | ${pct(s.recall)} | ${num(s.areaRatio, 2)} | ${num(s.kappa, 2)} |`;
  const L = [];
  L.push(`# Validazione: ${k.name}`, '');
  L.push(`Generato il ${info.created.slice(0, 10)} con \`node validation/validate.js --case ${info.case}\`.`, '');
  if (k.synthetic) L.push('> **Caso sintetico**: il perimetro "osservato" è costruito a mano per provare lo strumento. I numeri non dicono nulla sull\'affidabilità del modello.', '');

  L.push('## Dati del caso', '');
  L.push('| | |', '| --- | --- |');
  L.push(`| Zona | ${info.zone} (${info.crs}, celle da ${info.res} m) |`);
  L.push(`| Perimetro osservato | \`${k.perimeter}\`${k.perimeter_source ? ` · ${k.perimeter_source}` : ''} |`);
  L.push(`| Area osservata | ${num(r.observed.ha)} ha, di cui ${num(r.observed.haBurnable)} ha su celle combustibili (usate nel confronto) |`);
  L.push(`| Innesco | ${info.ignitions.map(({ r: rr, c }) => `r${rr} c${c}`).join(', ')} · ${info.ignitionNote} |`);
  L.push(`| Ora dell'innesco | ${info.start} (UTC)${k.start_source ? ` · ${k.start_source}` : ''} |`);
  L.push(`| Durata simulata | ${info.hours} h; fine osservata dopo ${hm(info.tEndMin)} |`);
  L.push(`| Meteo | ${info.meteo} |`);
  L.push(`| Vento medio | ${num(w.speed)} m/s da ${Math.round(w.from)}° (rapporto lunghezza/larghezza dell'ellisse ${num(w.lw, 2)}) |`);
  L.push(`| Barriere OSM | ${info.barriers === 'assolute' ? 'assolute (ogni strada ferma il fuoco)' : info.barriers ? 'attraversabili secondo la lunghezza di fiamma (D46)' : 'disattivate'} |`);
  const fi = info.fuelNdviInfo;
  L.push(`| Combustibile | CORINE 2018${fi ? ` corretto a 10 m dall'NDVI (D54): soglia di Otsu ${fi.threshold.toFixed(2)}, separazione ${fi.separation.toFixed(2)}; erba → macchia ${fi.changed.herbToShrub} celle, arbusti → erba ${fi.changed.shrubToHerb}, bosco → erba con alberi ${fi.changed.litterToGrass}` : ''} |`);
  const tw = info.terrainWind;
  L.push(`| Vento sul terreno | ${!tw ? 'uniforme sulla zona' : tw.method === 'campo' ? `campo di vento di WindNinja (${tw.runsFrom?.length ?? '?'} corse da ${Math.min(...(tw.runsFrom ?? [0]))} a ${Math.max(...(tw.runsFrom ?? [0]))} gradi; Forthofer et al. 2014)` : tw.method === 'massa' ? `conservazione della massa in uno strato alto ${tw.blhM === 'era5' ? 'quanto lo strato limite orario di ERA5' : `${tw.blhM} m`} (D53)` : `corretto dal rilievo, MicroMet (Liston & Elder 2006), η ${tw.etaM ?? 500} m`} |`);
  L.push(`| Modello | Rothermel (1972) + ellisse di Anderson (1983) + tempo minimo di arrivo (Dijkstra su 16 direzioni) |`, '');

  if (info.warnings.length) {
    L.push('## Avvertenze', '');
    for (const x of info.warnings) L.push(`- ${x}`);
    L.push('');
  }

  L.push('## 1. Forma: confronto ad area uguale', '');
  L.push('Il modello è fermato quando ha bruciato la stessa area combustibile dell\'incendio osservato. Il confronto non dipende dall\'ora di fine (spesso incerta per lo spegnimento) e misura solo **dove** il fuoco è andato. Cerchio ed ellisse sono riferimenti che non sanno nulla di combustibile e terreno: un modello utile deve batterli.', '');
  L.push('| Modello | Sørensen | Jaccard | Precisione | Recall | Area sim./oss. | Kappa |', '| --- | --- | --- | --- | --- | --- | --- |');
  L.push(row('**Modello** — Rothermel + tempo di arrivo', r.C.areaMatched));
  L.push(row('Ellisse del vento medio', e));
  L.push(row('Cerchio', r.baselines.circle), '');
  L.push(`Area osservata raggiunta dal modello dopo **${hm(r.C.areaMatched.tMin)}**.`, '');
  L.push(`**Miglioramento rispetto all'ellisse** (sul Sørensen; 0% = come l'ellisse, 100% = perfetto, negativo = peggio): ${pct(r.skills.C)}.`, '');

  L.push('## 2. Area e forma alla fine osservata', '');
  L.push(`Celle bruciate entro ${hm(info.tEndMin)} dall'innesco. Qui pesa anche la velocità: se il modello è troppo lento o troppo veloce l'area è sbagliata. Lo spegnimento non è simulato, quindi una sovrastima è attesa.`, '');
  L.push('| Modello | Sørensen | Jaccard | Precisione | Recall | Area sim./oss. | Kappa |', '| --- | --- | --- | --- | --- | --- | --- |');
  L.push(row('**Modello**', r.C.atEnd));
  L.push('');
  L.push(`Area simulata alla fine: ${num(r.C.burnedHaEnd)} ha; osservata ${num(r.observed.haBurnable)} ha.`, '');

  L.push('## 3. Tempi: punti caldi satellitari', '');
  if (!r.C.hotspots) {
    L.push('Nessun file di punti caldi FIRMS nel caso: tempi non verificati.', '');
  } else {
    const s = r.C.hotspots.summary;
    L.push(`Un punto caldo indica fuoco attivo nel pixel all'ora del passaggio del satellite: il fronte simulato deve esserci già arrivato. «In ritardo» = il fronte arriva più di ${s.tolMin} minuti dopo il passaggio; «coerente» = arriva prima o entro la tolleranza.`, '');
    L.push('| Modello | Punti usati | Coerenti | In ritardo | Non raggiunti | Errore mediano (arrivo − passaggio) |', '| --- | --- | --- | --- | --- | --- |');
    L.push(`| **Modello** | ${s.used} | ${pct(s.consistent)} | ${pct(s.late)} | ${pct(s.notReached)} | ${s.medianErrMin === null ? '—' : `${Math.round(s.medianErrMin)} min`} |`);
    L.push('');
    L.push(`Punti caldi nel file: ${s.total}; prima dell'innesco ${s.beforeIgnition} (se sono molti, l'ora di innesco è troppo tarda); fuori zona ${s.outside}. Dettaglio in \`punti_caldi.csv\`.`, '');
  }

  if (r.ensemble) {
    const e2 = r.ensemble, s2 = e2.summary, st = e2.settings;
    L.push('## 4. Insieme di simulazioni', '');
    L.push(`${e2.members} simulazioni con i dati incerti fatti variare: innesco entro ${st.radiusM} m${st.within ? ' e dentro l\'area osservata' : ''}, ora tra +${Math.round(st.windowMin[0])} e +${Math.round(st.windowMin[1])} minuti, vento ±${Math.round(st.windPct * 100)}% in velocità e ±${st.windDeg}° in direzione (seme ${st.seed}). Ogni simulazione è confrontata ad area uguale; la mappa \`probabilita.png\` dà la quota di simulazioni che bruciano ogni cella, con il contorno dell'area osservata in nero.`, '');
    L.push('| Misura | Valore |', '| --- | --- |');
    L.push(`| Sørensen, mediana (quartili) | ${pct(s2.sorensen.median)} (${pct(s2.sorensen.q1)}–${pct(s2.sorensen.q3)}) |`);
    L.push(`| Sørensen, minimo – massimo | ${pct(s2.sorensen.min)} – ${pct(s2.sorensen.max)} |`);
    L.push(`| Sørensen del consenso (celle bruciate in almeno metà delle simulazioni) | ${pct(s2.consensus.sorensen)} |`);
    L.push(`| Area osservata con probabilità ≥ 50% | ${pct(s2.observedCoveredHalf)} |`);
    L.push(`| Probabilità media dentro l'area osservata | ${pct(s2.meanProbInside)} |`);
    L.push(`| Probabilità media fuori (celle bruciate almeno una volta) | ${pct(s2.meanProbOutsideBurnt)} |`, '');
  }

  L.push('## Come leggere le misure', '');
  L.push('- **Sørensen** (o Dice): 2 × celle in comune / (celle osservate + celle simulate). 100% = stesse celle bruciate, 0% = nessuna in comune. È l\'indice più usato per confrontare perimetri di incendi.');
  L.push('- **Jaccard**: celle in comune / celle bruciate in almeno una delle due. Più severo di Sørensen.');
  L.push('- **Precisione**: parte dell\'area simulata che è bruciata davvero (il complemento è il falso allarme).');
  L.push('- **Recall**: parte dell\'area bruciata davvero che il modello ha preso (il complemento è l\'area mancata).');
  L.push('- **Kappa di Cohen**: accordo oltre quello dovuto al caso, su tutte le celle combustibili della zona; dipende dalla dimensione della zona, quindi va confrontato solo tra simulazioni dello stesso caso.');
  L.push('- La mappa `confronto.png` (ad area uguale): verde = in comune, blu = bruciata ma non simulata, arancio = simulata ma non bruciata, quadrato nero = innesco.', '');
  L.push('Un solo incendio non basta per un giudizio generale: la stima di affidabilità va data come media e intervallo su più casi, dichiarando l\'incertezza su innesco, ora e meteo.', '');
  return L.join('\n');
}
