"""Controllo delle scarpate ai bordi del bosco (possibile artefatto del DSM).

Uso (dalla cartella Software):  python pipeline/edge_slope_check.py mercadante

Il DEM Copernicus GLO-30 e' un modello di superficie: include le chiome. Dove il bosco
confina con campi aperti la "quota" salta dell'altezza degli alberi e la pendenza di Horn
mostra una falsa scarpata lungo il confine. Il controllo confronta la pendenza in una
fascia di +-2 celle (20 m) attorno al confine bosco/non bosco con quella lontano dal confine.
Fascia molto piu' ripida delle altre due zone = indizio forte di artefatto da chioma.
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FOREST = [8, 9, 10]   # modelli di combustibile forestali (vedi tables/corine_to_fuel.csv)


def dilate(m, n):
    """Dilatazione a 4 vicini ripetuta n volte."""
    for _ in range(n):
        p = np.pad(m, 1, mode="edge")
        m = m | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def main():
    zone = sys.argv[1] if len(sys.argv) > 1 else "mercadante"
    d = Path(zone) if Path(zone).is_dir() else ROOT / "data" / "zones" / zone / "processed"
    fuel, slope = np.load(d / "fuel.npy"), np.load(d / "slope.npy")
    forest = np.isin(fuel, FOREST)
    band = dilate(forest, 2) & dilate(~forest, 2)
    for name, m in [("fascia di bordo", band), ("bosco interno", forest & ~band),
                    ("fuori bosco", ~forest & ~band)]:
        if not m.any():
            print(f"{name:16s} nessuna cella")
            continue
        s = slope[m]
        print(f"{name:16s} celle {m.sum():7d}  pendenza mediana {np.median(s):5.1f} gradi"
              f"  95 percentile {np.percentile(s, 95):5.1f}  celle >15 gradi {np.mean(s > 15):6.1%}")


if __name__ == "__main__":
    main()
