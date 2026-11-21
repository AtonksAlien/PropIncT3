// Zone disponibili: config/zones/<id>.json + pacchetto data/zones/<id>/processed/ prodotto dalla pipeline.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadZone } from '../../engine/load-node.js';
import { utmToLatLon, utmZoneOf } from '../../engine/geo.js';

const ID = /^[a-z0-9_-]+$/;
export const PUBLIC_LAYERS = ['fuel', 'elevation', 'slope', 'aspect', 'ndvi', 'barriers', 'barrier_width'];

export class Zones {
  constructor(root) {
    this.root = root;
    this.grids = new Map();   // solo i layer leggeri che servono al server (combustibile per validare gli inneschi)
  }

  configPath(id) { return join(this.root, 'config', 'zones', `${id}.json`); }
  processedDir(id) { return join(this.root, 'data', 'zones', id, 'processed'); }
  meteoCacheDir(id) { return join(this.root, 'data', 'zones', id, 'raw', 'meteo'); }

  exists(id) { return typeof id === 'string' && ID.test(id) && existsSync(this.configPath(id)); }
  ready(id) { return this.exists(id) && existsSync(join(this.processedDir(id), 'manifest.json')); }
  config(id) { return JSON.parse(readFileSync(this.configPath(id), 'utf8')); }
  manifest(id) { return JSON.parse(readFileSync(join(this.processedDir(id), 'manifest.json'), 'utf8')); }

  list() {
    return readdirSync(join(this.root, 'config', 'zones'))
      .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => ID.test(id))
      .map((id) => {
        const cfg = this.config(id);
        return { id, name: cfg.name, ready: this.ready(id), resolution_m: cfg.resolution_m, aoi_wgs84: cfg.aoi_wgs84 };
      });
  }

  /** Informazioni per il frontend: griglia e i 4 angoli in lat/lon (la griglia UTM è ruotata rispetto ai meridiani). */
  info(id) {
    const m = this.manifest(id), z = utmZoneOf(m.crs), b = m.bounds_utm;
    const corner = (x, y) => { const p = utmToLatLon(x, y, z); return [p.lat, p.lon]; };
    return {
      id, name: m.name, crs: m.crs, rows: m.rows, cols: m.cols, resolution_m: m.resolution_m,
      origin_utm: m.origin_utm, bounds_utm: b, center_wgs84: m.center_wgs84,
      corners_wgs84: { nw: corner(b.xmin, b.ymax), ne: corner(b.xmax, b.ymax), se: corner(b.xmax, b.ymin), sw: corner(b.xmin, b.ymin) },
      layers: Object.fromEntries(PUBLIC_LAYERS.filter((k) => m.layers[k]).map((k) => [k, { ...m.layers[k], unit: m.units[k] }])),
      sources: m.sources, checks: m.checks, barriers: m.barriers ?? null,
      meteo_point_wgs84: this.config(id).meteo_point_wgs84 ?? null,   // il browser scarica da qui il meteo
    };
  }

  layerPath(id, layer) {
    if (!PUBLIC_LAYERS.includes(layer) || !this.manifest(id).layers[layer]) return null;   // es. barriere non generate
    return join(this.processedDir(id), this.manifest(id).layers[layer].file);
  }

  /** Griglia con il solo combustibile, tenuta in memoria per validare gli inneschi senza avviare un worker. */
  fuelGrid(id) {
    if (!this.grids.has(id)) this.grids.set(id, loadZone(this.processedDir(id), ['fuel', 'barriers', 'barrier_width']));
    return this.grids.get(id);
  }
}
