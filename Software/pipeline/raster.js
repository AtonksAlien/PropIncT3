// Rasterizzazione di linee e poligoni su una griglia regolare (coordinate in celle: x verso Est, y verso Sud).
//
// Linee: "tutte le celle toccate" (all touched), come previsto in DATI_GREZZI §5 per strade e acqua: una
// strada larga 6 m deve interrompere ogni cella che attraversa, anche solo in un angolo. Si percorrono
// esattamente le celle attraversate dal segmento con l'algoritmo di Amanatides & Woo (1987).
// Poligoni: celle il cui centro è dentro (regola pari/dispari) + contorno con le celle toccate.

/** Celle attraversate dal segmento (x0,y0)–(x1,y1); chiama visit(r, c) per ciascuna. */
export function traverseSegment(x0, y0, x1, y1, visit) {
  let c = Math.floor(x0), r = Math.floor(y0);
  const cEnd = Math.floor(x1), rEnd = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const stepC = dx > 0 ? 1 : -1, stepR = dy > 0 ? 1 : -1;
  // distanza (in frazione del segmento) per attraversare una cella e per raggiungere il primo bordo
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? c + 1 - x0 : x0 - c) * tDeltaX) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? r + 1 - y0 : y0 - r) * tDeltaY) : Infinity;
  visit(r, c);
  let guard = Math.abs(cEnd - c) + Math.abs(rEnd - r) + 2;
  while ((c !== cEnd || r !== rEnd) && guard-- > 0) {
    if (Math.abs(tMaxX - tMaxY) < 1e-12) {   // passaggio esatto per un vertice: tocca anche le due celle laterali
      visit(r, c + stepC); visit(r + stepR, c);
      c += stepC; r += stepR; tMaxX += tDeltaX; tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) { c += stepC; tMaxX += tDeltaX; } else { r += stepR; tMaxY += tDeltaY; }
    visit(r, c);
  }
}

/** Polilinea (array di [x, y]) con tutte le celle toccate. */
export function rasterizeLine(points, visit) {
  for (let k = 1; k < points.length; k++) traverseSegment(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1], visit);
}

/** Poligono chiuso: interno (centri delle celle, pari/dispari) + contorno. rows, cols limitano la scansione. */
export function rasterizePolygon(points, rows, cols, visit) {
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of points) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
  for (let r = Math.max(0, Math.floor(yMin)); r <= Math.min(rows - 1, Math.floor(yMax)); r++) {
    const yc = r + 0.5, xs = [];
    for (let k = 1; k < points.length; k++) {
      const [xa, ya] = points[k - 1], [xb, yb] = points[k];
      if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c <= Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5)); c++) visit(r, c);
    }
  }
  rasterizeLine(points, visit);
}
