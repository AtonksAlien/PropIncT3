// Perimetro osservato (GeoJSON) → maschera di celle sulla griglia della zona.
//
// Accetta Polygon e MultiPolygon, con buchi (regola pari/dispari dentro ogni poligono) e più elementi
// (unione). Coordinate in WGS84 (lon, lat: il formato standard di GeoJSON) oppure in UTM Nord se il file
// dichiara un "crs" EPSG:326xx, come fa QGIS esportando senza riproiettare.
// Una cella è "bruciata" se il suo centro cade dentro il perimetro.

import { latLonToUtm, utmToLatLon, utmZoneOf } from '../../engine/geo.js';

/** Fuso UTM dichiarato nel GeoJSON (membro "crs" del vecchio standard), oppure null = WGS84. */
function declaredUtmZone(geojson) {
  const name = geojson?.crs?.properties?.name ?? '';
  const m = /EPSG::?326(\d\d)\b/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Elementi del GeoJSON (FeatureCollection, Feature o geometria) filtrati per proprietà. */
function features(geojson, filter) {
  const list = geojson.type === 'FeatureCollection' ? geojson.features
    : geojson.type === 'Feature' ? [geojson] : [{ type: 'Feature', properties: {}, geometry: geojson }];
  if (!filter) return list;
  const allowed = new Set(filter.values.map(String));
  return list.filter((f) => allowed.has(String(f.properties?.[filter.field])));
}

/**
 * @param grid    griglia della zona (engine/load-node.js)
 * @param geojson perimetro già letto (oggetto)
 * @param opts    { filter: { field, values } } per tenere solo alcuni elementi (es. gradi di danno)
 * @returns { mask: Uint8Array (1 = dentro), cells, features, cut: true se il perimetro esce dalla griglia }
 */
export function rasterizePerimeter(grid, geojson, { filter = null } = {}) {
  const { rows, cols, res } = grid, o = grid.manifest.origin_utm;
  const gridZone = utmZoneOf(grid.manifest.crs), fileZone = declaredUtmZone(geojson);
  // vertice → coordinate frazionarie (colonna, riga) della griglia
  const toGrid = ([a, b]) => {
    let x = a, y = b;
    if (fileZone === null) {
      if (Math.abs(a) > 180 || Math.abs(b) > 90) throw new Error('Coordinate fuori dai limiti di lon/lat: esporta il perimetro in EPSG:4326 (WGS84)');
      ({ x, y } = latLonToUtm(b, a, gridZone));
    } else if (fileZone !== gridZone) {
      const p = utmToLatLon(a, b, fileZone);
      ({ x, y } = latLonToUtm(p.lat, p.lon, gridZone));
    }
    return [(x - o.x) / res, (o.y - y) / res];
  };

  const mask = new Uint8Array(rows * cols);
  let cut = false, used = 0;
  for (const f of features(geojson, filter)) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.length) used++;
    for (const rings of polys) {
      const pr = rings.map((ring) => ring.map(toGrid));
      let rMin = Infinity, rMax = -Infinity;
      for (const ring of pr) for (const [c, r] of ring) {
        if (c < 0 || r < 0 || c > cols || r > rows) cut = true;
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      }
      // scansione per righe: intersezioni dei lati con la linea dei centri, riempimento a coppie (pari/dispari)
      for (let r = Math.max(0, Math.floor(rMin)); r <= Math.min(rows - 1, Math.ceil(rMax)); r++) {
        const yc = r + 0.5, xs = [];
        for (const ring of pr) {
          for (let k = 0; k < ring.length - 1; k++) {
            const [x1, y1] = ring[k], [x2, y2] = ring[k + 1];
            if ((y1 <= yc && yc < y2) || (y2 <= yc && yc < y1)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(cols - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
          for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
        }
      }
    }
  }
  let cells = 0;
  for (const v of mask) cells += v;
  return { mask, cells, features: used, cut };
}
