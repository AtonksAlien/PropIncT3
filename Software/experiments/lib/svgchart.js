// Grafici SVG statici per la tesi (vettoriali: nitidi in stampa), senza dipendenze.
// Regole (skill dataviz): un solo asse y; palette categoriale in ordine fisso, validata con
// validate_palette.js (modalità chiara, superficie #fcfcfb); linee 2 px, marcatori 8 px con anello
// di 2 px sul colore della superficie; griglia recessiva; legenda in alto + etichetta diretta a fine
// linea (≤ 4 serie); testo sempre nei colori del testo, mai in quello della serie; <title> per punto
// (tooltip al passaggio del mouse nel browser). Ogni figura ha anche la tabella CSV dei dati.

export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];   // blu, arancio, verde acqua, giallo
const SURFACE = '#fcfcfb', INK = '#0b0b0b', INK2 = '#52514e', GRID = '#e4e3de', AXIS = '#9b9a95';
const FONT = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1).replace(/\.0$/, '') : String(+v.toFixed(2))).replace('.', ',');

/** Tacche "tonde" (1, 2, 5 × 10^k) tra a e b. */
function niceTicks(a, b, n = 5) {
  const span = b - a || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n + 0.5) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const logTicks = (a, b) => {
  const out = [];
  const mult = Math.log10(b / a) > 3 ? [1] : [1, 2, 5];   // oltre 3 decenni solo le potenze di 10
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const m of mult) {
    const v = m * 10 ** e; if (v >= a * 0.999 && v <= b * 1.001) out.push(v);
  }
  return out;
};

/**
 * @param o.series [{ name, points: [[x, y], ...], color?, dash? }]
 * @param o.xLog / o.yLog scala logaritmica · o.diagonal disegna y = x · o.markers (default true)
 */
export function chart(o) {
  const W = o.width ?? 720, H = o.height ?? 420;
  const m = { top: 78, right: o.series.length <= 4 && !o.noEndLabels ? 150 : 24, bottom: o.note ? 74 : 58, left: 66 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const pts = o.series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  let [x0, x1] = o.xRange ?? [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  let [y0, y1] = o.yRange ?? [o.yLog ? Math.min(...pts.map((p) => p[1])) : Math.min(0, ...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const xt = o.xLog ? logTicks(x0, x1) : niceTicks(x0, x1, o.xTicks ?? 6);
  const yt = o.yLog ? logTicks(y0, y1) : niceTicks(y0, y1 * 1.05, 5);
  if (!o.xLog && !o.xRange) { x0 = Math.min(x0, xt[0]); x1 = Math.max(x1, xt.at(-1)); }
  if (!o.yLog && !o.yRange) { y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt.at(-1)); }
  const sx = (x) => m.left + (o.xLog ? (Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (x - x0) / (x1 - x0)) * pw;
  const sy = (y) => m.top + ph - (o.yLog ? (Math.log10(y) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (y - y0) / (y1 - y0)) * ph;

  const g = [];
  g.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  g.push(`<text x="${m.left}" y="26" font-size="16" font-weight="600" fill="${INK}">${esc(o.title)}</text>`);
  if (o.subtitle) g.push(`<text x="${m.left}" y="45" font-size="12" fill="${INK2}">${esc(o.subtitle)}</text>`);
  // legenda in alto (sempre, con ≥ 2 serie)
  if (o.series.length > 1) {
    let lx = m.left;
    for (const [k, s] of o.series.entries()) {
      const c = s.color ?? PALETTE[k];
      g.push(`<line x1="${lx}" y1="62" x2="${lx + 18}" y2="62" stroke="${c}" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`);
      if (o.markers !== false) g.push(`<circle cx="${lx + 9}" cy="62" r="4" fill="${c}" stroke="${SURFACE}" stroke-width="2"/>`);
      g.push(`<text x="${lx + 24}" y="66" font-size="12" fill="${INK2}">${esc(s.name)}</text>`);
      lx += 34 + s.name.length * 6.6;
    }
  }
  // griglia e assi (recessivi)
  for (const v of yt) g.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${sy(v)}" y2="${sy(v)}" stroke="${GRID}" stroke-width="1"/><text x="${m.left - 8}" y="${sy(v) + 4}" font-size="11" text-anchor="end" fill="${INK2}">${fmt(v)}</text>`);
  for (const v of xt) g.push(`<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.top + ph}" y2="${m.top + ph + 4}" stroke="${AXIS}"/><text x="${sx(v)}" y="${m.top + ph + 18}" font-size="11" text-anchor="middle" fill="${INK2}">${fmt(v)}</text>`);
  g.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${m.top + ph}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`);
  g.push(`<text x="${m.left + pw / 2}" y="${m.top + ph + 38}" font-size="12" text-anchor="middle" fill="${INK2}">${esc(o.xLabel)}</text>`);
  g.push(`<text transform="translate(16 ${m.top + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${INK2}">${esc(o.yLabel)}</text>`);
  if (o.diagonal) {
    const a = Math.max(x0, y0), b = Math.min(x1, y1);
    g.push(`<line x1="${sx(a)}" y1="${sy(a)}" x2="${sx(b)}" y2="${sy(b)}" stroke="${AXIS}" stroke-width="1" stroke-dasharray="4 4"/><text x="${sx(b) - 4}" y="${sy(b) + 14}" font-size="11" text-anchor="end" fill="${INK2}">A = C</text>`);
  }
  for (const h of o.hlines ?? []) g.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${AXIS}" stroke-dasharray="3 3"/><text x="${h.left ? m.left + 6 : m.left + pw - 4}" text-anchor="${h.left ? 'start' : 'end'}" y="${sy(h.y) + (h.below ? 15 : -6)}" font-size="11" fill="${INK2}">${esc(h.label)}</text>`);
  // serie
  const ends = [];
  for (const [k, s] of o.series.entries()) {
    const c = s.color ?? PALETTE[k];
    const p = s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.yLog || y > 0) && (!o.xLog || x > 0));
    if (o.lines !== false && p.length > 1) {
      g.push(`<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} points="${p.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"/>`);
    }
    if (o.markers !== false) for (const [x, y, label] of p) {
      g.push(`<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="4" fill="${c}" stroke="${SURFACE}" stroke-width="2"><title>${esc(`${s.name}: ${label ?? `${o.xLabel} ${fmt(x)} → ${fmt(y)}`}`)}</title></circle>`);
    }
    if (p.length && o.series.length <= 4 && !o.noEndLabels) ends.push({ y: sy(p.at(-1)[1]), x: sx(p.at(-1)[0]), name: s.name });
  }
  // etichette dirette a fine linea, distanziate per non sovrapporsi
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  for (const e of ends) g.push(`<text x="${m.left + pw + 8}" y="${e.y + 4}" font-size="12" fill="${INK}">${esc(e.name)}</text>`);
  if (o.note) g.push(`<text x="${m.left}" y="${H - 6}" font-size="11" fill="${INK2}">Nota: ${esc(o.note)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT} role="img" aria-label="${esc(o.title)}">\n<title>${esc(o.title)}</title>\n${g.join('\n')}\n</svg>\n`;
}

/** Tabella CSV (separatore ";" e virgola decimale, come Excel in italiano). */
export function csv(header, rows) {
  const cell = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toFixed(4)).replace('.', ',') : '') : String(v));
  return [header.join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\n') + '\n';
}
