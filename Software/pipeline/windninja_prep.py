"""Prepara il confronto con WindNinja (DECISIONI D53, PROBLEMI P37).

Uso (dalla cartella Software):  python pipeline/windninja_prep.py siniscola [velocita_ms] [direzioni]
    es.  python pipeline/windninja_prep.py siniscola 6 250:305:5

Scrive in data/zones/<zona>/windninja/:
  dem.tif                 quota del pacchetto zona (stessa griglia, stesso sistema di riferimento)
  wn_<dir>.cfg            una configurazione di WindNinja_cli per direzione del vento
  esegui_windninja.ps1    script PowerShell che lancia tutte le corse sul PC con WindNinja installato
WindNinja scrive in out/ le griglie ASCII <...>_vel.asc (m/s) e <...>_ang.asc (gradi, da dove proviene).

Scelte (dichiarate): inizializzazione "domain average" con vento uniforme a 10 m, solutore a conservazione
della massa (quello di base di WindNinja, lo stesso principio di engine/masswind.js), mesh di 50 m come
il nostro solutore, vegetazione "brush" (macchia), niente venti termici diurni: la notte dell'incendio di
Siniscola aveva maestrale forte, lo strato limite di ERA5 era intorno ai 1000 m.
"""
import json, sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parent.parent


def main():
    zone = sys.argv[1] if len(sys.argv) > 1 else "siniscola"
    speed = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    a, b, s = (int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "250:305:5").split(":"))
    dirs = list(range(a, b + 1, s))
    d = ROOT / "data" / "zones" / zone
    m = json.loads((d / "processed" / "manifest.json").read_text(encoding="utf-8"))
    out = d / "windninja"
    out.mkdir(exist_ok=True)

    z = np.load(d / "processed" / m["layers"]["elevation"]["file"]).astype("float32")
    T = from_origin(m["origin_utm"]["x"], m["origin_utm"]["y"], m["resolution_m"], m["resolution_m"])
    with rasterio.open(out / "dem.tif", "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1,
                       dtype="float32", crs=m["crs"], transform=T, nodata=-9999, compress="deflate") as dst:
        dst.write(np.where(np.isfinite(z), z, -9999).astype("float32"), 1)

    for k in dirs:
        (out / f"wn_{k:03d}.cfg").write_text("\n".join([
            "num_threads = 4",
            "elevation_file = dem.tif",
            "initialization_method = domainAverageInitialization",
            f"input_speed = {speed}",
            "input_speed_units = mps",
            f"input_direction = {k}",
            "input_wind_height = 10.0",
            "units_input_wind_height = m",
            "output_wind_height = 10.0",
            "units_output_wind_height = m",
            "output_speed_units = mps",
            "vegetation = brush",
            "mesh_resolution = 50.0",
            "units_mesh_resolution = m",
            "diurnal_winds = false",
            "write_ascii_output = true",
            "ascii_out_resolution = 50.0",
            "units_ascii_out_resolution = m",
            "output_path = out",
            "",
        ]), encoding="utf-8")

    (out / "esegui_windninja.ps1").write_text(f"""# Lancia WindNinja per tutte le direzioni (da PowerShell, in questa cartella):
#   powershell -ExecutionPolicy Bypass -File esegui_windninja.ps1
# Cerca WindNinja_cli.exe nelle cartelle di installazione abituali; altrimenti indicarlo con -Cli.
param([string]$Cli = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $Cli) {{
  $Cli = Get-ChildItem -Path "C:\\WindNinja","C:\\Program Files\\WindNinja","C:\\Program Files (x86)\\WindNinja" -Recurse -Filter WindNinja_cli.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}}
if (-not $Cli) {{ throw "WindNinja_cli.exe non trovato: lanciare con -Cli 'percorso\\WindNinja_cli.exe'" }}
New-Item -ItemType Directory -Force -Path out | Out-Null
$dem = (Resolve-Path dem.tif).Path
$outDir = (Resolve-Path out).Path
Get-ChildItem wn_*.cfg | ForEach-Object {{
  Write-Host "== $($_.Name)"
  # percorsi assoluti: WindNinja non risolve sempre quelli relativi rispetto alla cartella di lavoro
  $cfg = Join-Path $env:TEMP $_.Name
  (Get-Content $_.FullName) -replace '^elevation_file = .*', "elevation_file = $dem" -replace '^output_path = .*', "output_path = $outDir" | Set-Content -Encoding ascii $cfg
  & $Cli $cfg
  if ($LASTEXITCODE -ne 0) {{ throw "WindNinja ha restituito un errore su $($_.Name)" }}
}}
# alcune versioni scrivono accanto al DEM invece che in output_path: si raccolgono in out\\
Get-ChildItem -Path .\\* -Include *_vel.asc, *_ang.asc, *_vel.prj, *_ang.prj -File -ErrorAction SilentlyContinue | Move-Item -Destination out -Force
Write-Host "Fatto: griglie in out\\ (file *_vel.asc e *_ang.asc). Poi: git add -f data/zones/{zone}/windninja"
""", encoding="utf-8")
    print(f"DEM {z.shape[1]}x{z.shape[0]} celle da {m['resolution_m']} m ({m['crs']}), "
          f"{len(dirs)} configurazioni ({dirs[0]}-{dirs[-1]} gradi, {speed} m/s) in {out}")


if __name__ == "__main__":
    main()
