"""Recupero dell'NDVI da un'immagine di visualizzazione del Copernicus Browser.

L'immagine scaricata e' RGB: ogni valore NDVI e' stato colorato con la rampa
pubblica dello script "NDVI" di Sentinel Hub (interpolazione lineare tra le
tappe sotto). Invertendo la rampa si riottiene l'NDVI con un errore pari al
passo di quantizzazione (circa 0,005). Fonte della rampa:
https://custom-scripts.sentinel-hub.com/sentinel-2/ndvi/
"""
import numpy as np

RAMP = [(-0.5, "0c0c0c"), (-0.2, "bfbfbf"), (-0.1, "dbdbdb"), (0.0, "eaeaea"),
        (0.025, "fff9cc"), (0.05, "ede8b5"), (0.075, "ddd89b"), (0.1, "ccc682"),
        (0.125, "bcb76b"), (0.15, "afc160"), (0.175, "a3cc59"), (0.2, "91bf51"),
        (0.25, "7fb247"), (0.3, "70a33f"), (0.35, "609635"), (0.4, "4f892d"),
        (0.45, "3f7c23"), (0.5, "306d1c"), (0.55, "216011"), (0.6, "0f540a"),
        (1.0, "004400")]


def ndvi_from_rgb(rgb, step=1e-4):
    """rgb: array (3, H, W) con valori 0-1 o 0-255. Ritorna (ndvi, residuo_rgb)."""
    a = np.asarray(rgb, dtype=np.float64)
    if a.max() <= 1.0:
        a = a * 255.0
    a = np.round(a).reshape(3, -1).T
    vals = np.array([v for v, _ in RAMP])
    cols = np.array([[int(h[i:i + 2], 16) for i in (0, 2, 4)] for _, h in RAMP], float)
    xs = np.arange(vals[0], vals[-1] + step, step)
    lut = np.stack([np.interp(xs, vals, cols[:, k]) for k in range(3)], axis=1)
    uniq, inv = np.unique(a, axis=0, return_inverse=True)
    best = np.empty(len(uniq), dtype=np.int64)
    res = np.empty(len(uniq))
    for i0 in range(0, len(uniq), 256):  # a blocchi per contenere la memoria
        d = ((uniq[i0:i0 + 256, None, :] - lut[None]) ** 2).sum(2)
        best[i0:i0 + 256] = d.argmin(1)
        res[i0:i0 + 256] = np.sqrt(d[np.arange(d.shape[0]), best[i0:i0 + 256]])
    h, w = rgb.shape[1:]
    inv = inv.ravel()
    return xs[best][inv].reshape(h, w).astype(np.float32), res[inv].reshape(h, w).astype(np.float32)
