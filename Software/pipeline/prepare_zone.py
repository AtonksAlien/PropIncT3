"""Pipeline di pre-elaborazione di una zona: dai dati grezzi al pacchetto per il motore.
Funziona in qualsiasi fuso UTM Nord (campo "crs" della configurazione, es. EPSG:32632 per la Sardegna).

Uso (dalla cartella Software):  python pipeline/prepare_zone.py --zone mercadante

Passi:
 1. griglia master UTM (fuso della configurazione) a 10 m sull'AOI + margine (config/zones/<zona>.json)
 2. riproiezione di DEM (bilineare, mosaico di piu' riquadri), NDVI (bilineare) e Corine (vicino piu' prossimo)
 3. NDVI recuperato dall'immagine colorata (ndvi_palette.py)
 4. pendenza ed esposizione con Horn, sulla griglia con margine
 5. Corine -> codice CLC -> modello di combustibile (tabelle in pipeline/tables)
 6. ritaglio sull'AOI, controlli automatici, scrittura di .npy + manifest.json
"""
import argparse, csv, json, sys
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling, transform_bounds

sys.path.insert(0, str(Path(__file__).parent))
from ndvi_palette import ndvi_from_rgb
from terrain import horn
from checks import run_checks

ROOT = Path(__file__).resolve().parent.parent
TABLES = ROOT / "pipeline" / "tables"


def master_grid(cfg, buffer_m):
    a, r = cfg["aoi_utm"], cfg["resolution_m"]
    x0, y0 = a["xmin"] - buffer_m, a["ymin"] - buffer_m
    x1, y1 = a["xmax"] + buffer_m, a["ymax"] + buffer_m
    return from_origin(x0, y1, r, r), int(round((x1 - x0) / r)), int(round((y1 - y0) / r))


def warp(src_array, src_transform, src_crs, src_nodata, dst_t, w, h, crs, method, dtype, fill):
    dst = np.full((h, w), fill, dtype=dtype)
    reproject(src_array, dst, src_transform=src_transform, src_crs=src_crs, src_nodata=src_nodata,
              dst_transform=dst_t, dst_crs=crs, dst_nodata=fill, resampling=method)
    return dst


def read_table(name, key, val, cast):
    with open(TABLES / name, newline="", encoding="utf-8") as f:
        return {int(r[key]): cast(r[val]) for r in csv.DictReader(f)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", required=True)
    zone = ap.parse_args().zone
    cfg = json.loads((ROOT / "config" / "zones" / f"{zone}.json").read_text(encoding="utf-8"))
    zdir = ROOT / "data" / "zones" / zone
    out = zdir / "processed"
    out.mkdir(parents=True, exist_ok=True)
    crs, res, buf = cfg["crs"], cfg["resolution_m"], cfg["processing_buffer_m"]
    T, W, H = master_grid(cfg, buf)
    print(f"[1] Griglia master {W}x{H} celle da {res} m (AOI + {buf} m)")

    dem_files = cfg["inputs"]["dem"]
    dem_files = [dem_files] if isinstance(dem_files, str) else dem_files
    dem = np.full((H, W), np.nan, dtype="float32")
    for f in dem_files:  # mosaico: ogni riquadro riempie solo le celle ancora vuote
        with rasterio.open(zdir / f) as s:
            part = warp(s.read(1).astype("float32"), s.transform, s.crs, s.nodata, T, W, H, crs,
                        Resampling.bilinear, "float32", np.nan)
        dem = np.where(np.isnan(dem), part, dem)
    print(f"[2] DEM riproiettato da {len(dem_files)} file: {np.nanmin(dem):.0f}-{np.nanmax(dem):.0f} m, "
          f"celle vuote {np.isnan(dem).sum()}")

    bands = cfg["inputs"].get("ndvi_bands")
    if cfg["inputs"].get("ndvi_rgb") is None and not bands:   # NDVI non disponibile (dichiarato nella config)
        ndvi = np.full((H, W), np.nan, dtype="float32")
        ndvi_src = "non disponibile: niente radure dal NDVI, umidità viva dallo scenario del mese"
        print("[3] NDVI assente (inputs.ndvi_rgb = null): radure e umidità viva dall'NDVI disattivate")
    elif bands:  # NDVI calcolato dalle riflettanze: (B08 - B04) / (B08 + B04)
        with rasterio.open(zdir / bands["red"]) as r, rasterio.open(zdir / bands["nir"]) as n:
            red, nir = r.read(1).astype("float32"), n.read(1).astype("float32")
            den = nir + red
            nd_src = np.where(den > 0, (nir - red) / np.where(den > 0, den, 1), np.nan).astype("float32")
            ndvi = warp(nd_src, r.transform, r.crs, None, T, W, H, crs, Resampling.bilinear, "float32", np.nan)
            src_res = r.res[0]
        ndvi_src = f"calcolato da B04/B08 (pixel di partenza {src_res:.0f} m)"
        print(f"[3] NDVI da B04/B08 ({src_res:.0f} m): mediana {np.nanmedian(ndvi):.2f}")
    else:      # NDVI ricostruito dall'immagine colorata del Copernicus Browser
        with rasterio.open(zdir / cfg["inputs"]["ndvi_rgb"]) as s:
            nd_src, resid = ndvi_from_rgb(s.read())
            ndvi = warp(nd_src, s.transform, s.crs, None, T, W, H, crs, Resampling.bilinear, "float32", np.nan)
        ndvi_src = "recuperato dalla palette Sentinel Hub"
        print(f"[3] NDVI recuperato dalla palette: residuo RGB mediano {np.median(resid):.2f}, "
              f"99% sotto {np.percentile(resid, 99):.2f}")

    with rasterio.open(zdir / cfg["inputs"]["corine"]) as s:
        clc_idx = warp(s.read(1).astype("int16"), s.transform, s.crs, s.nodata, T, W, H, crs,
                       Resampling.nearest, "int16", -128)

    slope, aspect, tan_s = horn(dem, res)
    print(f"[4] Pendenza (Horn): mediana {np.nanmedian(slope):.1f} gradi")

    legend = read_table("corine_legend.csv", "raster_index", "clc_code", int)
    to_fuel = read_table("corine_to_fuel.csv", "clc_code", "fuel_model", int)
    clc = np.vectorize(lambda i: legend.get(int(i), 0), otypes=[np.int16])(clc_idx)
    fuel = np.vectorize(lambda c: to_fuel.get(int(c), 0), otypes=[np.uint8])(clc)
    clearing = np.isin(fuel, [8, 9, 10]) & (ndvi < 0.2)
    fuel[clearing] = 1
    print(f"[5] Combustibile: {clearing.sum()} celle di bosco con NDVI < 0,2 riclassificate come radura")

    b = buf // res
    sl = (slice(b, H - b), slice(b, W - b))
    layers = {"elevation": dem[sl], "slope": slope[sl], "aspect": aspect[sl], "tan_slope": tan_s[sl],
              "ndvi": ndvi[sl], "clc": clc[sl], "fuel": fuel[sl]}
    h, w = layers["elevation"].shape
    a = cfg["aoi_utm"]

    print("[6] Controlli:")
    checks = run_checks(crs, res, layers, mapped_clc=set(to_fuel))
    for ok, msg in checks:
        print(f"    {'OK ' if ok else 'ERR'} {msg}")

    for name, arr in layers.items():
        np.save(out / f"{name}.npy", arr)
    lon0, lat0, lon1, lat1 = transform_bounds(crs, "EPSG:4326", a["xmin"], a["ymin"], a["xmax"], a["ymax"])
    manifest = {
        "zone": zone, "name": cfg["name"], "created": date.today().isoformat(),
        "crs": crs, "resolution_m": res, "rows": h, "cols": w,
        "origin_utm": {"x": a["xmin"], "y": a["ymax"]}, "row_order": "nord-sud",
        "bounds_utm": a, "bounds_wgs84": [[lat0, lon0], [lat1, lon1]],
        "center_wgs84": [(lat0 + lat1) / 2, (lon0 + lon1) / 2],
        "layers": {k: {"file": f"{k}.npy", "dtype": str(v.dtype)} for k, v in layers.items()},
        "units": {"elevation": "m", "slope": "gradi", "aspect": "gradi da Nord, -1 = piatto",
                  "tan_slope": "-", "ndvi": "-", "clc": "codice CLC", "fuel": "Anderson 13, 0 = non combustibile"},
        "sources": {"dem": cfg.get("dem_source", "Copernicus GLO-30 (OpenTopography)"),
                    "ndvi": f"Sentinel-2 L2A {cfg['sentinel2_date']}, {ndvi_src}",
                    "landcover": "CORINE Land Cover 2018, 100 m"},
        "checks": [{"ok": bool(ok), "msg": m} for ok, m in checks],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Pacchetto scritto in {out} ({h}x{w} celle)")
    if not all(ok for ok, _ in checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
