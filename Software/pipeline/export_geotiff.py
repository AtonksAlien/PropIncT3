"""Esporta il pacchetto zona (.npy + manifest.json) in GeoTIFF per la verifica in QGIS.

Uso (dalla cartella Software):  python pipeline/export_geotiff.py mercadante
            oppure:                  python pipeline/export_geotiff.py <cartella processed>

La georeferenziazione e' ricostruita SOLO dal manifest:
  origin_utm = angolo in alto a sinistra (xmin, ymax), resolution_m = lato cella,
  row_order "nord-sud" = riga 0 a Nord (come in un GeoTIFF standard).
Scrive in processed/geotiff/:
  <layer>.tif          un file per layer (float32 con nodata NaN, interi senza nodata)
  fuel.tif             con tabella colori incorporata (si apre gia' colorato)
  qgis_<layer>.txt     mappe colori da caricare in QGIS ("Carica mappa colori da file")
I .npy non vengono modificati: i GeoTIFF sono copie di sola visualizzazione.
"""
import json, sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parent.parent

# Colori dei modelli Anderson 13 (scelta di visualizzazione, non uno standard)
FUEL = {
    0: ((200, 200, 200), "0 non combustibile"),
    1: ((255, 240, 150), "1 erba bassa"),
    2: ((230, 200, 90), "2 erba sotto copertura rada"),
    3: ((210, 170, 60), "3 erba alta"),
    4: ((120, 60, 30), "4 macchia alta"),
    5: ((200, 140, 90), "5 arbusti bassi"),
    6: ((190, 110, 60), "6 arbusti"),
    7: ((150, 90, 50), "7 arbusti sotto bosco"),
    8: ((140, 190, 120), "8 lettiera compatta (misto)"),
    9: ((60, 160, 70), "9 lettiera latifoglie"),
    10: ((20, 90, 40), "10 lettiera con sottobosco (pineta)"),
    11: ((230, 120, 120), "11 residui leggeri"),
    12: ((200, 60, 60), "12 residui medi"),
    13: ((140, 20, 20), "13 residui pesanti"),
}
# Esposizione: piatto + 8 settori centrati sui punti cardinali (ciclica: N rosso, S ciano)
ASPECT = [(-1, (180, 180, 180), "piatto (-1)"), (22.5, (230, 50, 50), "N"),
          (67.5, (240, 150, 40), "NE"), (112.5, (240, 230, 60), "E"), (157.5, (120, 200, 60), "SE"),
          (202.5, (60, 200, 200), "S"), (247.5, (60, 120, 230), "SO"), (292.5, (120, 60, 200), "O"),
          (337.5, (220, 60, 180), "NO"), (360, (230, 50, 50), "N")]
# Pendenza: classi in gradi (limite superiore incluso)
SLOPE = [(2, (255, 255, 204), "0-2"), (5, (255, 237, 160), "2-5"), (10, (254, 178, 76), "5-10"),
         (15, (253, 141, 60), "10-15"), (20, (240, 59, 32), "15-20"), (30, (189, 0, 38), "20-30"),
         (90, (80, 0, 20), ">30")]
# NDVI: rampa continua (marrone -> verde scuro)
NDVI = [(-0.2, (120, 80, 40), "-0,2"), (0.1, (190, 160, 110), "0,1"), (0.2, (230, 220, 150), "0,2"),
        (0.4, (170, 210, 110), "0,4"), (0.6, (80, 170, 70), "0,6"), (0.8, (20, 100, 40), "0,8"),
        (1.0, (0, 60, 20), "1,0")]


def write_colormap(path, interp, rows):
    """Formato testo di QGIS: 'valore,R,G,B,A,etichetta'."""
    lines = ["# QGIS Generated Color Map Export File", f"INTERPOLATION:{interp}"]
    lines += [f"{v},{c[0]},{c[1]},{c[2]},255,{lab}" for v, c, lab in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    zone = sys.argv[1] if len(sys.argv) > 1 else "mercadante"
    d = Path(zone) if Path(zone).is_dir() else ROOT / "data" / "zones" / zone / "processed"
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    if m.get("row_order") != "nord-sud":
        sys.exit(f"row_order {m.get('row_order')!r} non gestito (atteso 'nord-sud')")
    res, rows, cols = m["resolution_m"], m["rows"], m["cols"]
    T = from_origin(m["origin_utm"]["x"], m["origin_utm"]["y"], res, res)
    out = d / "geotiff"
    out.mkdir(exist_ok=True)

    # Coerenza interna del manifest: origine + celle devono ridare i confini UTM
    b = m["bounds_utm"]
    exp = (m["origin_utm"]["x"] + cols * res, m["origin_utm"]["y"] - rows * res)
    if (b["xmax"], b["ymin"]) != exp:
        print(f"ATTENZIONE: bounds_utm {b} non coerenti con origine + {cols}x{rows} celle -> {exp}")

    for name, info in m["layers"].items():
        arr = np.load(d / info["file"])
        if arr.shape != (rows, cols):
            sys.exit(f"{name}: forma {arr.shape} diversa da {rows}x{cols} del manifest")
        floating = np.issubdtype(arr.dtype, np.floating)
        prof = dict(driver="GTiff", height=rows, width=cols, count=1, dtype=arr.dtype.name,
                    crs=m["crs"], transform=T, compress="deflate",
                    nodata=(np.nan if floating else None))
        with rasterio.open(out / f"{name}.tif", "w", **prof) as dst:
            dst.write(arr, 1)
            dst.set_band_description(1, f"{name} [{m['units'].get(name, '')}]")
            if name == "fuel":
                dst.write_colormap(1, {k: c + (255,) for k, (c, _) in FUEL.items()})
        vals = arr[np.isfinite(arr)] if floating else arr
        print(f"{name:10s} {arr.dtype.name:8s} min {vals.min():9.2f}  max {vals.max():9.2f}"
              f"  nodata {arr.size - vals.size}")

    write_colormap(out / "qgis_fuel.txt", "EXACT", [(k, c, lab) for k, (c, lab) in FUEL.items()])
    write_colormap(out / "qgis_aspect.txt", "DISCRETE", ASPECT)
    write_colormap(out / "qgis_slope.txt", "DISCRETE", SLOPE)
    write_colormap(out / "qgis_ndvi.txt", "INTERPOLATED", NDVI)
    print(f"GeoTIFF e mappe colori scritti in {out}")
    print(f"Estensione attesa in QGIS ({m['crs']}): x {m['origin_utm']['x']}-{exp[0]}, "
          f"y {exp[1]}-{m['origin_utm']['y']}")


if __name__ == "__main__":
    main()
