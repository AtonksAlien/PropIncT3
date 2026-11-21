// Coda di priorità (min-heap binario) su TypedArray: chiave = tempo (Float64), valore = indice di cella (Int32).
// Niente oggetti per elemento: con centinaia di migliaia di inserimenti conta per memoria e velocità.
// Cancellazione "pigra": se un tempo migliora si reinserisce la cella; la copia vecchia si scarta all'estrazione.

export class MinHeap {
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  push(key, val) {
    if (this.size === this.keys.length) this.#grow();
    let i = this.size++;
    const { keys, vals } = this;
    while (i > 0) {                       // risale finché il padre è più grande
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = key; vals[i] = val;
  }

  /** Estrae il minimo: ritorna l'indice di cella; la chiave è in `lastKey`. */
  pop() {
    const { keys, vals } = this;
    const topVal = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n], val = vals[n];
      let i = 0;
      for (;;) {                          // scende verso il figlio minore
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = key; vals[i] = val;
    }
    return topVal;
  }

  #grow() {
    const k = new Float64Array(this.keys.length * 2); k.set(this.keys); this.keys = k;
    const v = new Int32Array(this.vals.length * 2); v.set(this.vals); this.vals = v;
  }
}
