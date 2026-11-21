import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import { parseNpy } from '../../engine/npy.js';
import { latLonToCell } from '../../engine/grid.js';
import { simulationRequest, checkHourly } from '../../engine/meteo-source.js';
import { GridLayer } from './GridLayer.js';
import { paintArrival, paintFuel, paintBarriers, isochroneLegend, FUEL_STYLE, CROSSING_STYLE, BLOCKING, barrierText, crossingClass, FRONT_MIN } from './paint.js';
import { romeLocalToISO, romeClock, fmtMinutes, romeNowLocal, meteoSourceFor } from './time.js';

const SPEEDS = [5, 15, 30, 60, 120];   // minuti simulati per secondo di riproduzione
const PHASE = { meteo: 'Scarico il meteo…', calcolo: 'Calcolo in corso…' };

/**
 * Meteo scaricato dal browser, con la quota gratuita di Open-Meteo del visitatore (il server su Render ha un
 * indirizzo condiviso, che esaurisce presto la propria). Se non riesce ritorna null e lo scarica il server.
 */
async function browserMeteo(point, start, durMin) {
  if (!point) return null;
  try {
    const q = simulationRequest(point, start, durMin);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(q.url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const json = checkHourly(await res.json(), { start, durMin });
    return { model: q.model, json: { hourly: json.hourly } };
  } catch {
    return null;
  }
}

export default function App() {
  // --- stato
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState(null);
  const [info, setInfo] = useState(null);
  const [fuel, setFuel] = useState(null);
  const [showFuel, setShowFuel] = useState(true);
  const [barriers, setBarriers] = useState(null);         // layer OSM (Uint8Array) o null se assente
  const [showBarriers, setShowBarriers] = useState(true);
  const [useBarriers, setUseBarriers] = useState(true);    // true = attraversabili (D46), 'assolute', false = nessuna
  const [barrierWidth, setBarrierWidth] = useState(null);  // larghezza in metri delle celle di barriera (255 = invalicabile)
  const [meteoMode, setMeteoMode] = useState('reale');
  const [date, setDate] = useState('2023-07-25T13:00');
  const [wind, setWind] = useState({ speed: 6, from: 240 });
  const [hours, setHours] = useState(3);
  const [ignitions, setIgnitions] = useState([]);
  const [status, setStatus] = useState({ phase: 'idle', msg: 'Clicca sulla mappa per aggiungere un innesco.' });
  const [result, setResult] = useState(null);     // { meta, arrival }
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [burned, setBurned] = useState(null);     // celle bruciate entro t
  const [hover, setHover] = useState(null);       // cella sotto il puntatore

  // --- riferimenti a oggetti non React (mappa, strati, socket)
  const mapDiv = useRef(null), map = useRef(null), markers = useRef(null), outline = useRef(null);
  const fuelLayer = useRef(null), fireLayer = useRef(null), fireImg = useRef(null), barrierLayer = useRef(null);
  const socket = useRef(null), simId = useRef(null);
  const latest = useRef({});   // valori correnti per i gestori di eventi Leaflet
  latest.current = { info, fuel, ignitions, result, barriers, barrierWidth, useBarriers };

  // --- mappa (una volta)
  useEffect(() => {
    const m = L.map(mapDiv.current, { zoomControl: true, preferCanvas: true }).setView([40.882, 16.685], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    m.on('click', (e) => addIgnition(e.latlng));
    m.on('mousemove', (e) => setHover(cellAt(e.latlng)));
    m.on('mouseout', () => setHover(null));
    // il pannello del browser o la finestra possono cambiare dimensione: Leaflet va avvisato
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(mapDiv.current);
    map.current = m;
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  // --- connessione al server (una volta)
  useEffect(() => {
    const s = io({ transports: ['websocket'] });
    s.on('sim:progress', (msg) => { if (msg.simId === simId.current) setStatus({ phase: msg.phase, msg: PHASE[msg.phase] }); });
    s.on('sim:result', (msg) => {
      if (msg.simId !== simId.current) return;
      const b = msg.arrival;
      const buf = b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      setResult({ meta: msg.meta, arrival: new Float32Array(buf) });
      setT(0); setPlaying(true);
      setStatus({ phase: 'done', msg: `Calcolata in ${(msg.meta.computeMs / 1000).toFixed(1)} s.` });
      simId.current = null;
    });
    s.on('sim:error', (msg) => { if (msg.simId === simId.current) { setStatus({ phase: 'error', msg: msg.error }); simId.current = null; } });
    s.on('sim:cancelled', (msg) => { if (msg.simId === simId.current) { setStatus({ phase: 'idle', msg: 'Simulazione annullata.' }); simId.current = null; } });
    s.on('connect_error', () => setStatus({ phase: 'error', msg: 'Server non raggiungibile (avviare il backend).' }));
    socket.current = s;
    fetch('/api/zones').then((r) => r.json()).then((list) => {
      setZones(list);
      setZoneId(list.find((z) => z.ready)?.id ?? null);
    }).catch(() => setStatus({ phase: 'error', msg: 'Server non raggiungibile (avviare il backend).' }));
    return () => s.close();
  }, []);

  // --- zona: informazioni, combustibile, strati
  useEffect(() => {
    if (!zoneId) return;
    let alive = true;
    (async () => {
      const zi = await (await fetch(`/api/zones/${zoneId}`)).json();
      const npy = parseNpy(await (await fetch(`/api/zones/${zoneId}/layers/fuel`)).arrayBuffer());
      const bar = zi.layers.barriers ? parseNpy(await (await fetch(`/api/zones/${zoneId}/layers/barriers`)).arrayBuffer()).data : null;
      const bw = zi.layers.barrier_width ? parseNpy(await (await fetch(`/api/zones/${zoneId}/layers/barrier_width`)).arrayBuffer()).data : null;
      if (!alive) return;
      const m = map.current, c = zi.corners_wgs84;
      fuelLayer.current?.remove(); fireLayer.current?.remove(); outline.current?.remove(); barrierLayer.current?.remove();
      fuelLayer.current = new GridLayer(c, zi.cols, zi.rows, { opacity: 0.75, zIndex: 401 });
      fireLayer.current = new GridLayer(c, zi.cols, zi.rows, { zIndex: 403 });
      barrierLayer.current = bar ? new GridLayer(c, zi.cols, zi.rows, { zIndex: 402 }) : null;
      fireLayer.current.addTo(m);
      fuelLayer.current.setImage(paintFuel(new ImageData(zi.cols, zi.rows), npy.data));
      fireImg.current = new ImageData(zi.cols, zi.rows);
      outline.current = L.polygon([c.nw, c.ne, c.se, c.sw], { color: '#333', weight: 1.5, fill: false, interactive: false }).addTo(m);
      m.invalidateSize();
      m.fitBounds(outline.current.getBounds(), { padding: [10, 10] });
      setInfo(zi); setFuel(npy.data); setBarriers(bar); setBarrierWidth(bw); setIgnitions([]); setResult(null);
    })();
    return () => { alive = false; };
  }, [zoneId]);

  useEffect(() => {
    const m = map.current, layer = fuelLayer.current;
    if (!m || !layer) return;
    if (showFuel) layer.addTo(m); else layer.remove();
  }, [showFuel, info]);

  // colori delle barriere: dipendono dalla modalità (attraversabili, assolute, spente)
  useEffect(() => {
    const layer = barrierLayer.current;
    if (!layer || !barriers || !info) return;
    layer.setImage(paintBarriers(new ImageData(info.cols, info.rows), barriers, barrierWidth, useBarriers));
  }, [barriers, barrierWidth, useBarriers, info]);

  useEffect(() => {
    const m = map.current, layer = barrierLayer.current;
    if (!m || !layer) return;
    if (showBarriers) layer.addTo(m); else layer.remove();
  }, [showBarriers, info]);

  // --- celle e inneschi
  function cellAt({ lat, lng }) {
    const { info: zi, fuel: f, result: res } = latest.current;
    if (!zi || !f) return null;
    const grid = { rows: zi.rows, cols: zi.cols, res: zi.resolution_m, manifest: { crs: zi.crs, origin_utm: zi.origin_utm } };
    const { r, c } = latLonToCell(grid, lat, lng);
    if (r < 0 || c < 0 || r >= zi.rows || c >= zi.cols) return null;
    const i = r * zi.cols + c;
    const { barriers: bar, barrierWidth: bw } = latest.current;
    return { r, c, lat, lon: lng, fuel: f[i], barrier: bar ? bar[i] : 0, width: bw ? bw[i] : null, arrival: res?.arrival[i] };
  }
  function addIgnition(latlng) {
    const cell = cellAt(latlng), ign = latest.current.ignitions;
    if (!cell) { setStatus({ phase: 'idle', msg: 'Il punto è fuori dalla zona.' }); return; }
    if (cell.fuel === 0) { setStatus({ phase: 'idle', msg: 'Cella non combustibile: scegli un altro punto.' }); return; }
    if (latest.current.useBarriers !== false && BLOCKING.includes(cell.barrier)) { setStatus({ phase: 'idle', msg: `${barrierText(cell.barrier, cell.width, latest.current.useBarriers)}. Su una barriera il fuoco non parte: scegli un altro punto.` }); return; }
    if (ign.length >= 20) return;
    setIgnitions([...ign, cell]);
    setStatus({ phase: 'idle', msg: 'Innesco aggiunto. Premi «Simula» quando sei pronto.' });
  }
  useEffect(() => {
    markers.current?.clearLayers();
    for (const p of ignitions) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#1d4ed8', weight: 3, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(`r${p.r} c${p.c} · ${FUEL_STYLE[p.fuel]?.name ?? p.fuel}`).addTo(markers.current);
    }
  }, [ignitions]);

  // --- richiesta della simulazione
  const startIso = meteoMode === 'reale' && date ? romeLocalToISO(date) : null;
  const source = startIso ? meteoSourceFor(startIso, hours) : null;
  async function run() {
    if (!ignitions.length || !socket.current) return;
    if (source && !source.ok) { setStatus({ phase: 'error', msg: source.label }); return; }
    const req = { zone: zoneId, hours: Number(hours), barriers: useBarriers, ignitions: ignitions.map(({ r, c }) => ({ r, c })) };
    setPlaying(false);
    if (startIso) {
      req.start = startIso;
      setStatus({ phase: 'invio', msg: 'Scarico il meteo da Open-Meteo…' });
      req.meteo = await browserMeteo(info?.meteo_point_wgs84, new Date(startIso), Number(hours) * 60);
    } else req.wind = { speed: Number(wind.speed), from: Number(wind.from) };
    setStatus({ phase: 'invio', msg: 'Invio della richiesta…' });
    socket.current.emit('sim:start', req, (ack) => {
      if (ack.ok) simId.current = ack.simId;
      else setStatus({ phase: 'error', msg: ack.error });
    });
  }
  function cancel() { if (simId.current) socket.current.emit('sim:cancel', { simId: simId.current }, () => {}); }

  // --- disegno al tempo t
  useEffect(() => {
    if (!fireLayer.current || !fireImg.current) return;
    if (!result) { fireLayer.current.setImage(null); setBurned(null); return; }
    setBurned(paintArrival(fireImg.current, result.arrival, t, result.meta.maxMin));
    fireLayer.current.setImage(fireImg.current);
  }, [result, t]);

  // --- riproduzione
  useEffect(() => {
    if (!playing || !result) return;
    let last = performance.now(), raf;
    const step = (now) => {
      const dt = (now - last) / 1000; last = now;
      setT((prev) => {
        const next = Math.min(prev + dt * speed, result.meta.maxMin);
        if (next >= result.meta.maxMin) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, result]);

  const busy = ['invio', 'meteo', 'calcolo'].includes(status.phase);
  const legend = useMemo(() => (result ? isochroneLegend(result.meta.maxMin) : []), [result]);
  // legenda del combustibile: solo i modelli presenti nella zona aperta
  const fuelPresent = useMemo(() => {
    if (!fuel) return [];
    const seen = new Set(fuel);
    return Object.keys(FUEL_STYLE).filter((k) => seen.has(Number(k)));
  }, [fuel]);
  // legenda delle barriere: solo le classi presenti (con le barriere assolute tutte uguali)
  const barrierLegend = useMemo(() => {
    if (!barriers) return [];
    const seen = new Set();
    for (let i = 0; i < barriers.length; i++) {
      const t = barriers[i];
      if (t) seen.add(t !== 2 && (useBarriers === 'assolute' || !barrierWidth) ? 'wall' : crossingClass(t, barrierWidth ? barrierWidth[i] : null));
    }
    return Object.keys(CROSSING_STYLE).filter((k) => seen.has(k));
  }, [barriers, barrierWidth, useBarriers]);
  const startMs = result?.meta.start ? Date.parse(result.meta.start) : null;
  const cellHa = info ? (info.resolution_m ** 2) / 1e4 : 0;
  const ha = (cells) => (cells * cellHa).toFixed(1);
  const arrivalText = (v) => (v === undefined ? '' : Number.isFinite(v) ? fmtMinutes(v) : 'non raggiunta');

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>PropInc</h1>
          <p className="sub">Simulatore di propagazione degli incendi boschivi</p>
        </header>

        <section>
          <label>Zona
            <select value={zoneId ?? ''} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => <option key={z.id} value={z.id} disabled={!z.ready}>{z.name}{z.ready ? '' : ' (senza dati)'}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={showFuel} onChange={(e) => setShowFuel(e.target.checked)} /> Mostra il combustibile</label>
          {barriers && <label className="check"><input type="checkbox" checked={showBarriers} onChange={(e) => setShowBarriers(e.target.checked)} /> Mostra strade e acqua (OpenStreetMap)</label>}
        </section>

        {barriers && (
          <section>
            <label title="Strade asfaltate, ferrovie e acqua da OpenStreetMap sono fasce senza combustibile">Strade e acqua
              <select value={String(useBarriers)} onChange={(e) => setUseBarriers(e.target.value === 'true' ? true : e.target.value === 'false' ? false : 'assolute')}>
                <option value="true">attraversabili secondo la fiamma</option>
                <option value="assolute">fermano sempre il fuoco</option>
                <option value="false">ignorate</option>
              </select>
            </label>
            {useBarriers === true && <p className="hint">Il fuoco supera una strada se è larga meno di 2 volte la sua fiamma (+4 m con vento oltre 5 m/s). Laghi e invasi sono invalicabili.</p>}
          </section>
        )}

        <section>
          <h2>Meteo</h2>
          <div className="seg">
            <button className={meteoMode === 'reale' ? 'on' : ''} onClick={() => setMeteoMode('reale')}>Reale (Open-Meteo)</button>
            <button className={meteoMode === 'costante' ? 'on' : ''} onClick={() => setMeteoMode('costante')}>Vento costante</button>
          </div>
          {meteoMode === 'reale' ? (
            <>
              <label>Innesco (ora italiana)
                <span className="row tight">
                  <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                  <button type="button" className="small" onClick={() => setDate(romeNowLocal())} title="Ora attuale: previsione ICON-2I">Adesso</button>
                </span>
              </label>
              {source && <p className={`hint ${source.ok ? '' : 'bad'}`}>{source.ok ? `Fonte: ${source.label}` : source.label}</p>}
            </>
          ) : (
            <div className="row">
              <label>Vento m/s<input type="number" min="0" max="40" step="0.5" value={wind.speed} onChange={(e) => setWind({ ...wind, speed: e.target.value })} /></label>
              <label>Da (°)<input type="number" min="0" max="360" step="5" value={wind.from} onChange={(e) => setWind({ ...wind, from: e.target.value })} /></label>
            </div>
          )}
          <label>Durata: {hours} h
            <input type="range" min="1" max="12" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </label>
        </section>

        <section>
          <h2>Inneschi ({ignitions.length})</h2>
          {ignitions.length === 0 ? <p className="hint">Clicca sulla mappa, dentro il riquadro della zona.</p> : (
            <ul className="ign">{ignitions.map((p, k) => <li key={k}>r{p.r} c{p.c} · {FUEL_STYLE[p.fuel]?.name ?? p.fuel}</li>)}</ul>
          )}
          <div className="row">
            <button className="primary" disabled={!ignitions.length || busy || (source && !source.ok)} onClick={run}>Simula</button>
            {busy ? <button onClick={cancel}>Annulla</button> : <button disabled={!ignitions.length} onClick={() => { setIgnitions([]); setResult(null); }}>Cancella</button>}
          </div>
          <p className={`status ${status.phase}`}>{busy && <span className="spinner" />}{status.msg}</p>
        </section>

        {result && (
          <section>
            <h2>Risultato</h2>
            {burned !== null && <p className="big">{ha(burned)} ha <span className="sub">bruciati a {fmtMinutes(t)}</span></p>}
            <h3>Area bruciata per ora</h3>
            <table className="hours">
              <thead><tr><th>Ora</th><th>Area (ha)</th></tr></thead>
              <tbody>{result.meta.burnedByHour.map((v, h) => <tr key={h}><td>{h + 1} h</td><td>{v.toFixed(1)}</td></tr>)}</tbody>
            </table>
            <p className="hint">Calcolo: {(result.meta.computeMs / 1000).toFixed(2)} s · campi di Rothermel calcolati: {result.meta.fields}</p>
            {result.meta.weather.hourly.length > 0 && (
              <>
                <h3>Meteo ({result.meta.meteoModel}{result.meta.meteoBy === 'browser' ? ', scaricato dal browser' : result.meta.meteoBy === 'server' ? ', scaricato dal server' : ''})</h3>
                <table className="hours">
                  <thead><tr><th>Ora</th><th>°C</th><th>UR %</th><th>Vento</th><th>Umid. 1h</th></tr></thead>
                  <tbody>{result.meta.weather.hourly.map((w) => (
                    <tr key={w.t}><td>{romeClock(Date.parse(w.t))}</td><td>{w.temp.toFixed(0)}</td><td>{w.rh.toFixed(0)}</td>
                      <td>{w.windSpeed.toFixed(1)} m/s da {w.windFrom.toFixed(0)}°</td><td>{(w.m1 * 100).toFixed(1)}%</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
          </section>
        )}
      </aside>

      <main className="mapwrap">
        <div ref={mapDiv} className="map" />
        {hover && (
          <div className="readout">
            r{hover.r} c{hover.c} · {FUEL_STYLE[hover.fuel]?.name ?? `modello ${hover.fuel}`}
            {hover.barrier > 0 && <> · {barrierText(hover.barrier, hover.width, useBarriers)}</>}
            {hover.arrival !== undefined && <> · arrivo: {arrivalText(hover.arrival)}</>}
          </div>
        )}
        {result && (
          <div className="player">
            <button onClick={() => { if (t >= result.meta.maxMin) setT(0); setPlaying(!playing); }}>{playing ? '❚❚' : '▶'}</button>
            <input type="range" min="0" max={result.meta.maxMin} step="1" value={t}
              onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
            <span className="clock">{fmtMinutes(t)}{startMs ? ` · ore ${romeClock(startMs + t * 60000)}` : ''}</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Velocità di riproduzione">
              {SPEEDS.map((s) => <option key={s} value={s}>{s} min/s</option>)}
            </select>
          </div>
        )}
        <div className="legend">
          {result && (<>
            <h4>Tempo di arrivo</h4>
            <div className="item"><i style={{ background: 'rgb(255,255,210)', outline: '1px solid #999' }} />Fronte attivo (&lt; {FRONT_MIN} min)</div>
            {legend.map((l) => <div className="item" key={l.label}><i style={{ background: l.color }} />{l.label}</div>)}
          </>)}
          {barriers && showBarriers && (<>
            <h4>Strade e acqua (OSM){useBarriers === false ? ' · ignorate' : ''}</h4>
            {barrierLegend.map((k) => (
              <div className="item" key={k}><i style={{ background: `rgb(${CROSSING_STYLE[k].rgb.join(',')})` }} />{CROSSING_STYLE[k].name}</div>
            ))}
          </>)}
          {showFuel && (<>
            <h4>Combustibile</h4>
            {Object.entries(FUEL_STYLE).filter(([k]) => fuelPresent.includes(k)).map(([k, s]) => (
              <div className="item" key={k}><i style={{ background: `rgba(${s.rgb.join(',')},0.75)` }} />{s.name}</div>
            ))}
          </>)}
        </div>
      </main>
    </div>
  );
}
