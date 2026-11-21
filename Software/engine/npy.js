// Lettura del formato .npy di NumPy (versioni 1, 2, 3) in un TypedArray.
// Puro JavaScript: funziona in Node e nel browser (riceve un ArrayBuffer).

const DTYPES = {
  '<f4': Float32Array, '<f8': Float64Array,
  '|u1': Uint8Array, '<u1': Uint8Array, '|i1': Int8Array,
  '<i2': Int16Array, '<u2': Uint16Array, '<i4': Int32Array, '<u4': Uint32Array,
};

export function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(1, 6));
  if (bytes[0] !== 0x93 || magic !== 'NUMPY') throw new Error('File .npy non valido');
  const major = bytes[6];
  const view = new DataView(buffer);
  const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const start = major === 1 ? 10 : 12;
  const header = new TextDecoder('latin1').decode(bytes.subarray(start, start + headerLen));

  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1] === 'True';
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const Ctor = DTYPES[descr];
  if (!Ctor) throw new Error(`dtype non supportato: ${descr}`);
  if (fortran) throw new Error('Ordine Fortran non supportato');

  const offset = start + headerLen;
  const count = shape.reduce((a, b) => a * b, 1);
  // Copia in un buffer allineato: l'offset del dato non è sempre multiplo della dimensione dell'elemento.
  const data = new Ctor(buffer.slice(offset, offset + count * Ctor.BYTES_PER_ELEMENT));
  return { data, shape, dtype: descr };
}

const DESCR = new Map([[Float32Array, '<f4'], [Float64Array, '<f8'], [Uint8Array, '|u1'], [Int8Array, '|i1'],
  [Int16Array, '<i2'], [Uint16Array, '<u2'], [Int32Array, '<i4'], [Uint32Array, '<u4']]);

/** Scrive un TypedArray nel formato .npy versione 1 (leggibile da numpy.load). @returns Uint8Array */
export function writeNpy(typed, shape) {
  const descr = DESCR.get(typed.constructor);
  if (!descr) throw new Error('Tipo non supportato per .npy');
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  header += ' '.repeat((64 - ((10 + header.length + 1) % 64)) % 64) + '\n';   // allineamento a 64 byte, come NumPy
  const out = new Uint8Array(10 + header.length + typed.byteLength);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
  new DataView(out.buffer).setUint16(8, header.length, true);
  for (let k = 0; k < header.length; k++) out[10 + k] = header.charCodeAt(k);
  out.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), 10 + header.length);
  return out;
}
