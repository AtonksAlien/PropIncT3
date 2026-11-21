"""Pendenza ed esposizione con l'algoritmo di Horn (finestra 3x3 pesata)."""
import numpy as np


def horn(z, cell):
    """z: quote (righe da Nord a Sud), cell: lato cella in metri.
    Ritorna slope (gradi), aspect (azimut 0-360 da Nord in senso orario,
    direzione verso cui il versante scende; -1 se piatto), tan(slope)."""
    p = np.pad(z, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]   # NW N NE
    d, f = p[1:-1, :-2], p[1:-1, 2:]                   # W  E
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]       # SW S SE
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell)   # verso Est
    dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * cell)   # verso Nord
    tan_s = np.hypot(dzdx, dzdy)
    slope = np.degrees(np.arctan(tan_s))
    aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) + 360.0) % 360.0
    aspect[tan_s < 1e-6] = -1.0
    return slope.astype(np.float32), aspect.astype(np.float32), tan_s.astype(np.float32)
