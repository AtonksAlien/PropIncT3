// Scrittura dei risultati del confronto nel tempo (lib/temporal.js):
//   temporale.md            tabella per passaggio, da leggere e da copiare nella tesi
//   temporale.json          tutti i numeri, punti caldi compresi
//   temporale_passaggi.csv  una riga per passaggio (anche per i grafici pgfplots della tesi)

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pc = (x) => (x === null || x === undefined ? '–' : `${(100 * x).toFixed(1)}%`);
const mn = (x) => (x === null || x === undefined ? '–' : `${Math.round(x)}`);
const ha = (x) => (x === null || x === undefined ? '–' : x.toFixed(0));
const hm = (iso) => iso.slice(5, 16).replace('T', ' ');

/** @param r { source, case, start, passes: temporalAnalysis(...), ensemble: summarizeMembers(...) | null, members } */
export function writeTemporal(dir, r) {
  writeFileSync(join(dir, 'temporale.json'), JSON.stringify(r, (k, v) => (v === Infinity ? null : v), 2));
  const ens = new Map((r.ensemble ?? []).map((e) => [e.time, e]));
  const csv = ['ora_utc,min_dall_innesco,strumento,punti,osservato_ha,simulato_ha,sorensen,precisione,richiamo,sfasamento_min,sorensen_sfasamento,rif_perimetro_finale,'
    + 'raggiunti_entro_t,raggiunti_entro_t_tol,ritardo_mediano_min,ritardo_rmse_min,ins_sorensen_med,ins_sorensen_q1,ins_sorensen_q3,ins_sfasamento_med,ins_sfasamento_q1,ins_sfasamento_q3'];
  for (const p of r.passes) {
    const e = ens.get(p.time);
    const f = (x, d = 4) => (x === null || x === undefined ? '' : Number(x).toFixed(d));
    csv.push([p.time, f(p.tMin, 0), p.instruments, p.n, f(p.area.observedHa, 1), f(p.area.simulatedHa, 1), f(p.area.sorensen), f(p.area.precision), f(p.area.recall),
      f(p.area.bestLagMin, 0), f(p.area.sorensenBestLag), f(p.area.referenceFinalPerimeter), f(p.hotspots.reachedByT), f(p.hotspots.reachedByTtol),
      f(p.hotspots.lateMedianMin, 0), f(p.hotspots.lateRmseMin, 0),
      f(e?.sorensen.median), f(e?.sorensen.q1), f(e?.sorensen.q3), f(e?.bestLagMin.median, 0), f(e?.bestLagMin.q1, 0), f(e?.bestLagMin.q3, 0)].join(','));
  }
  writeFileSync(join(dir, 'temporale_passaggi.csv'), csv.join('\n') + '\n');

  const L = [];
  L.push(`# Confronto nel tempo — ${r.case}`, '');
  L.push(`Arrivo simulato: ${r.source}. Innesco ${r.start}. Area osservata a ogni passaggio = pixel dei punti caldi FIRMS di quel passaggio e dei precedenti, dentro il perimetro finale Copernicus EMS.`, '');
  L.push('| Passaggio (UTC) | min | Strumento | Punti | Oss. ha | Sim. ha | Sørensen | Rif. perimetro finale | Sfasamento (min) | Sørensen allo sfasamento | Punti raggiunti entro t | entro t+tol | Ritardo RMSE (min) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of r.passes) {
    L.push(`| ${hm(p.time)} | ${mn(p.tMin)} | ${p.instruments} | ${p.n} | ${ha(p.area.observedHa)} | ${ha(p.area.simulatedHa)} | ${pc(p.area.sorensen)} | ${pc(p.area.referenceFinalPerimeter)} | `
      + `${mn(p.area.bestLagMin)} | ${pc(p.area.sorensenBestLag)} | ${pc(p.hotspots.reachedByT)} | ${pc(p.hotspots.reachedByTtol)} | ${mn(p.hotspots.lateRmseMin)} |`);
  }
  if (r.ensemble?.length) {
    L.push('', `## Insieme di ${r.members} simulazioni: mediana (quartili)`, '');
    L.push('| Passaggio (UTC) | Sørensen | Sfasamento (min) | Sim. ha | Punti raggiunti entro t+tol | Ritardo RMSE (min) |');
    L.push('|---|---|---|---|---|---|');
    const q = (s, f) => `${f(s.median)} (${f(s.q1)}–${f(s.q3)})`;
    for (const e of r.ensemble) {
      L.push(`| ${hm(e.time)} | ${q(e.sorensen, pc)} | ${q(e.bestLagMin, mn)} | ${q(e.simulatedHa, ha)} | ${q(e.reachedByTtol, pc)} | ${q(e.lateRmseMin, mn)} |`);
    }
  }
  L.push('', 'Come leggere:',
    '- **Sørensen**: somiglianza tra area simulata con arrivo ≤ t e area osservata fino a t (1 = identiche).',
    '- **Rif. perimetro finale**: Sørensen di chi a ogni ora disegna già il perimetro finale; la simulazione aggiunge informazione sull\'evoluzione se lo supera.',
    '- **Sfasamento**: di quanti minuti spostare la simulazione per somigliare di più all\'osservato a t (positivo = la simulazione è in ritardo, negativo = in anticipo).',
    '- **Ritardo**: per ogni punto caldo, max(0, arrivo simulato nel pixel − t). È l\'unico errore di tempo certo: un punto caldo dice che il fuoco c\'era già, non da quando.',
    '- I pixel VIIRS (375 m) e soprattutto MODIS (1 km) sono più grandi delle celle (10 m): l\'area osservata dei primi passaggi è approssimata per eccesso.');
  writeFileSync(join(dir, 'temporale.md'), L.join('\n') + '\n');
}
