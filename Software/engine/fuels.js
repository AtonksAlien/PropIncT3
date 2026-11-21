// Modelli di combustibile Anderson 13: lettura di pipeline/tables/fuel_models.csv e conversione in SI.
// Fonte dei valori: Anderson (1982), INT-122, Tabella 1 (vedi pipeline/tables/README.md).

const TON_ACRE = 0.224170;  // t/acre (short ton) → kg/m²
const FT = 0.3048;          // ft → m
const LB_FT2 = 2000 / 43560; // t/acre → lb/ft²

export const FUEL_CONST = {
  sav10h: 109 / FT, sav100h: 30 / FT,  // 1/m
  heat: 18608,                          // kJ/kg (8000 BTU/lb)
  rhoP: 513,                            // kg/m³ (32 lb/ft³)
  sT: 0.0555, sE: 0.010,                // contenuto minerale totale ed effettivo
};

/** @returns array indicizzato per numero di modello (0 = non combustibile, null) */
export function parseFuelModels(csvText) {
  const [head, ...lines] = csvText.trim().split(/\r?\n/);
  const cols = head.split(',');
  const models = new Array(14).fill(null);
  for (const line of lines) {
    const v = Object.fromEntries(line.split(',').map((x, k) => [cols[k], x]));
    const num = (k) => Number(v[k]);
    models[num('fuel_model')] = {
      id: num('fuel_model'), name: v.nome,
      w1h: num('w_1h_t_ac') * TON_ACRE, w10h: num('w_10h_t_ac') * TON_ACRE, w100h: num('w_100h_t_ac') * TON_ACRE,
      wHerb: num('w_live_herb_t_ac') * TON_ACRE, wWoody: num('w_live_woody_t_ac') * TON_ACRE,
      sav1h: num('sav_1h_ft') / FT, savHerb: num('sav_live_herb_ft') / FT, savWoody: num('sav_live_woody_ft') / FT,
      depth: num('depth_ft') * FT, mxDead: num('mx_dead_pct') / 100,
      // Unità originali per rothermel.js (carichi in lb/ft²: 1 t/acre = 2000 lb / 43 560 ft²).
      us: {
        depth: num('depth_ft'), mxDead: num('mx_dead_pct') / 100,
        w1: num('w_1h_t_ac') * LB_FT2, w10: num('w_10h_t_ac') * LB_FT2, w100: num('w_100h_t_ac') * LB_FT2,
        wHerb: num('w_live_herb_t_ac') * LB_FT2, wWoody: num('w_live_woody_t_ac') * LB_FT2,
        sav1: num('sav_1h_ft'), savHerb: num('sav_live_herb_ft') || 1500, savWoody: num('sav_live_woody_ft') || 1500,
        dynamic: false,   // i 13 modelli di Anderson sono statici
      },
    };
  }
  return models;
}
