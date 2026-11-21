// Caricamento del pacchetto zona dal disco (solo Node). Il browser userà fetch + buildGrid.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGrid, LAYERS, OPTIONAL_LAYERS } from './grid.js';

export function loadZone(dir, layers = [...LAYERS, ...OPTIONAL_LAYERS]) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const buffers = {};
  for (const name of layers) {
    if (!manifest.layers[name]) {
      if (OPTIONAL_LAYERS.includes(name)) continue;   // es. barriere non ancora generate
      throw new Error(`Layer ${name} assente nel pacchetto ${dir}`);
    }
    const b = readFileSync(join(dir, manifest.layers[name].file));
    buffers[name] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  return buildGrid(manifest, buffers);
}
