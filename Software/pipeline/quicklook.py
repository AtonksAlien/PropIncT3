"""Anteprima visiva del pacchetto zona (4 pannelli) per il controllo a occhio."""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

zone = sys.argv[1] if len(sys.argv) > 1 else "mercadante"
d = Path(__file__).resolve().parent.parent / "data" / "zones" / zone / "processed"
m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
L = {k: np.load(d / v["file"]) for k, v in m["layers"].items()}
fig, ax = plt.subplots(2, 2, figsize=(11, 10), constrained_layout=True)
panels = [("elevation", "Quota (m)", "terrain"), ("slope", "Pendenza (gradi)", "magma"),
          ("ndvi", "NDVI", "YlGn"), ("fuel", "Modello di combustibile (Anderson 13)", "tab10")]
for a, (k, t, c) in zip(ax.ravel(), panels):
    im = a.imshow(L[k], cmap=c, vmin=(0 if k == "fuel" else None), vmax=(10 if k == "fuel" else None))
    a.set_title(t); a.set_xticks([]); a.set_yticks([])
    fig.colorbar(im, ax=a, shrink=0.8)
fig.suptitle(f"{m['name']} - {m['rows']}x{m['cols']} celle da {m['resolution_m']} m ({m['crs']})")
fig.savefig(d / "quicklook.png", dpi=110)
print("salvato", d / "quicklook.png")
