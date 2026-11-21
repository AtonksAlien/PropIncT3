"""Controlli automatici sul pacchetto zona. Ogni controllo ritorna (ok, messaggio)."""
import re

import numpy as np


def _dilate(m, n):
    """Dilatazione a 4 vicini ripetuta n volte."""
    for _ in range(n):
        p = np.pad(m, 1, mode="edge")
        m = m | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def run_checks(crs, res, layers, mapped_clc=None):
    out = []
    # qualsiasi fuso UTM Nord (EPSG:326xx): l'Italia sta nei fusi 32, 33 e 34
    out.append((re.fullmatch(r"EPSG:326\d\d", crs) is not None, f"CRS {crs} (atteso UTM Nord, EPSG:326xx)"))
    out.append((abs(res - 10) < 1e-6, f"risoluzione {res} m (attesa 10 m)"))
    z = layers["elevation"]
    out.append((np.isfinite(z).all() and 0 < z.min() < z.max() < 2000, f"quota {z.min():.0f}-{z.max():.0f} m"))
    s = layers["slope"]
    out.append((np.median(s) < 30 and s.max() < 80, f"pendenza mediana {np.median(s):.1f} gradi, max {s.max():.1f}"))
    n = layers["ndvi"]
    if np.isnan(n).all():   # NDVI dichiarato assente nella config: si segnala ma non blocca
        out.append((True, "NDVI assente (radure e umidità viva dall'NDVI disattivate)"))
    else:
        out.append((not np.isnan(n).any() and -1 <= np.nanmin(n) and np.nanmax(n) <= 1,
                    f"NDVI {np.nanmin(n):.2f}-{np.nanmax(n):.2f}, mediana {np.nanmedian(n):.2f}, celle senza dato {int(np.isnan(n).sum())}"))
    # Chiome nel DEM: un modello di superficie crea una falsa scarpata lungo il confine del bosco.
    # Si confronta la fascia di +-2 celle attorno al confine con la piu' ripida tra bosco interno e
    # fuori bosco: cosi' un bosco che sta davvero sui versanti (Dualchi) non e' un falso allarme.
    forest = np.isin(layers["clc"], [311, 312, 313])
    if forest.any() and (~forest).any():
        band = _dilate(forest, 2) & _dilate(~forest, 2)
        inner, outer = forest & ~band, ~forest & ~band
        if band.any() and inner.any() and outer.any():
            ref = max(np.median(s[inner]), np.median(s[outer]), 1e-6)
            ratio = np.median(s[band]) / ref
            out.append((ratio < 1.5, f"pendenza mediana bordo del bosco / zone lontane dal bordo {ratio:.2f} "
                                     "(sopra 1,5: chiome nel DEM?)"))
    if mapped_clc is not None:
        # una classe CORINE senza riga in corine_to_fuel.csv diventerebbe "non combustibile" senza avviso
        codes, counts = np.unique(layers["clc"], return_counts=True)
        missing = [f"{c} ({k} celle)" for c, k in zip(codes.tolist(), counts.tolist()) if c != 0 and c not in mapped_clc]   # 0 = fuori dal raster CORINE
        out.append((not missing, "classi CORINE tutte associate a un combustibile" if not missing
                    else "classi CORINE senza combustibile in corine_to_fuel.csv: " + ", ".join(missing)))
    f = layers["fuel"]
    frac = (f > 0).mean()
    out.append((0.05 < frac <= 1, f"celle combustibili {frac:.0%}"))
    return out
