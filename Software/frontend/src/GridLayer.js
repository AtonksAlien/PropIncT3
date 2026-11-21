// Strato Leaflet che disegna una griglia raster UTM (righe da Nord) sopra la mappa Web Mercator.
//
// Perché non L.imageOverlay: un'immagine Leaflet è sempre allineata a meridiani e paralleli, mentre la
// griglia UTM a Mercadante è ruotata di circa 1,1° (convergenza del meridiano a 1,7° dal meridiano
// centrale del fuso). Ai bordi l'errore sarebbe di circa 60 m. Qui l'immagine si disegna con una
// trasformazione affine calcolata dai 3 angoli della griglia (NO, NE, SO) in pixel dello schermo:
// su 6 km la differenza tra UTM e Mercator è affine a meno di frazioni di metro.

import L from 'leaflet';

export class GridLayer extends L.Layer {
  /** corners: { nw: [lat, lon], ne: [...], sw: [...] } angoli esterni della griglia; cols × rows celle. */
  constructor(corners, cols, rows, { opacity = 1, zIndex = 400 } = {}) {
    super();
    this.corners = corners; this.cols = cols; this.rows = rows;
    this.opacity = opacity; this.zIndex = zIndex;
    this.image = null;   // canvas sorgente cols × rows
  }

  onAdd(map) {
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide propinc-grid');
    this.canvas.style.position = 'absolute';
    this.canvas.style.zIndex = this.zIndex;
    this.canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('move zoomend resize viewreset', this.redraw, this);
    this.redraw();
  }

  onRemove(map) {
    map.off('move zoomend resize viewreset', this.redraw, this);
    this.canvas.remove();
  }

  /** Nuova immagine: canvas o ImageData di dimensione cols × rows. */
  setImage(image) {
    if (image instanceof ImageData) {
      if (!this.buffer) {
        this.buffer = document.createElement('canvas');
        this.buffer.width = this.cols; this.buffer.height = this.rows;
      }
      this.buffer.getContext('2d').putImageData(image, 0, 0);
      this.image = this.buffer;
    } else this.image = image;
    this.redraw();
  }

  redraw() {
    const map = this._map;
    if (!map || !this.canvas) return;
    const size = map.getSize();
    if (this.canvas.width !== size.x || this.canvas.height !== size.y) {
      this.canvas.width = size.x; this.canvas.height = size.y;
    }
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (!this.image) return;
    const p0 = map.latLngToContainerPoint(this.corners.nw);
    const p1 = map.latLngToContainerPoint(this.corners.ne);
    const p2 = map.latLngToContainerPoint(this.corners.sw);
    // colonne → vettore NO→NE, righe → vettore NO→SO (in pixel per cella)
    ctx.setTransform((p1.x - p0.x) / this.cols, (p1.y - p0.y) / this.cols,
      (p2.x - p0.x) / this.rows, (p2.y - p0.y) / this.rows, p0.x, p0.y);
    ctx.imageSmoothingEnabled = false;   // celle nette, niente sfumature tra una cella e l'altra
    ctx.globalAlpha = this.opacity;
    ctx.drawImage(this.image, 0, 0);
  }
}
