// Immagine RGB del risultato: combustibile sbiadito sotto, tempo di arrivo a bande orarie sopra.
// Puro JavaScript: lo stesso codice potrà riempire un ImageData nel canvas del frontend.

// Colori del combustibile (Anderson 13), sbiaditi perché fanno da sfondo.
const FUEL_RGB = {
  0: [200, 200, 200], 1: [236, 226, 170], 2: [214, 205, 140], 3: [225, 210, 120], 4: [190, 175, 130], 5: [215, 205, 160],
  6: [190, 200, 140], 8: [150, 180, 140], 9: [140, 185, 130], 10: [110, 160, 115],
};

// Rampa per il tempo di arrivo: giallo (presto) → rosso → viola scuro (tardi).
const RAMP = [[255, 237, 100], [253, 141, 60], [215, 48, 31], [127, 0, 70], [60, 0, 60]];

function ramp(t) {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(x), RAMP.length - 2), f = x - k;
  return RAMP[k].map((v, j) => Math.round(v + (RAMP[k + 1][j] - v) * f));
}

export function renderArrival(grid, arrival, maxMin, ignitions = [], bandMin = 60) {
  const { n, cols } = grid;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = arrival[i];
    let col;
    if (Number.isFinite(t)) {
      col = ramp(t / maxMin);
      // isocrona: bordo scuro dove la banda oraria cambia rispetto alla cella a destra o sotto
      const b = Math.floor(t / bandMin);
      const right = arrival[i + 1], down = arrival[i + cols];
      if ((Number.isFinite(right) && Math.floor(right / bandMin) !== b) ||
          (Number.isFinite(down) && Math.floor(down / bandMin) !== b)) col = [40, 20, 20];
    } else {
      col = FUEL_RGB[grid.fuel[i]] ?? [220, 220, 220];
    }
    rgb[i * 3] = col[0]; rgb[i * 3 + 1] = col[1]; rgb[i * 3 + 2] = col[2];
  }
  for (const { r, c } of ignitions) {   // croce blu sull'innesco
    for (let d = -4; d <= 4; d++) for (const [rr, cc] of [[r + d, c], [r, c + d]]) {
      if (rr < 0 || cc < 0 || rr >= grid.rows || cc >= cols) continue;
      const j = (rr * cols + cc) * 3;
      rgb[j] = 30; rgb[j + 1] = 60; rgb[j + 2] = 220;
    }
  }
  return rgb;
}

// Rampa logaritmica per la velocità di propagazione (m/min): 0,1 → 100.
const ROS_RAMP = [[255, 255, 204], [161, 218, 180], [65, 182, 196], [44, 127, 184], [37, 52, 148], [120, 0, 120]];

/** Mappa della velocità di Rothermel per cella; grigio dove non combustibile. */
export function renderRos(grid, ros, { min = 0.1, max = 100 } = {}) {
  const rgb = new Uint8Array(grid.n * 3);
  const l0 = Math.log10(min), l1 = Math.log10(max);
  for (let i = 0; i < grid.n; i++) {
    let col = [200, 200, 200];
    if (ros[i] > 0) {
      const x = Math.min(Math.max((Math.log10(ros[i]) - l0) / (l1 - l0), 0), 1) * (ROS_RAMP.length - 1);
      const k = Math.min(Math.floor(x), ROS_RAMP.length - 2), f = x - k;
      col = ROS_RAMP[k].map((v, j) => Math.round(v + (ROS_RAMP[k + 1][j] - v) * f));
    }
    rgb[i * 3] = col[0]; rgb[i * 3 + 1] = col[1]; rgb[i * 3 + 2] = col[2];
  }
  return rgb;
}
