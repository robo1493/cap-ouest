// Compteurs de séjour : jours aux États-Unis (12 mois glissants) et jours hors Québec (année civile).
//
// Règles simplifiées, à valider auprès des organismes :
// - États-Unis : un Canadien en visite ne doit pas dépasser ~182 jours par période de 12 mois.
//   Tout jour où l'on est aux États-Unis, même en partie (jour de passage de frontière), compte.
// - RAMQ : absence du Québec de moins de 183 jours par année civile (les autres provinces comptent
//   comme une absence) ; exception une fois tous les 7 ans, sur demande à la RAMQ.

export const US_LIMIT = 182;
export const QC_LIMIT = 183;   // à partir de 183 jours d'absence, l'admissibilité est perdue

const US = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

// « Badlands NP (Cedar Pass), SD » → 'US' ; « Regina, SK » → 'SK' ; sans code → null
export function regionOf(name) {
  const m = /,\s*([A-Z]{2})\s*$/.exec(name || '');
  if (!m) return null;
  return US.has(m[1]) ? 'US' : m[1];
}

const DAY = 864e5;
const parseIso = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const key = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

// Journal jour par jour : où l'on dort chaque nuit, et où l'on se trouve le matin et le soir.
// Une étape sans code de région prend la région de l'étape précédente.
export function dayLog(steps, startIso) {
  const start = parseIso(startIso);
  const nights = [];
  let region = regionOf(steps[0]?.name) || 'QC';
  steps.forEach(s => {
    region = regionOf(s.name) || region;
    for (let j = 0; j < s.nights; j++) nights.push(region);
  });
  const lastRegion = regionOf(steps[steps.length - 1]?.name) || region;
  const first = regionOf(steps[0]?.name) || 'QC';
  // Jour k : matin = nuit k-1 (ou départ), soir = nuit k (ou destination finale)
  const days = [];
  for (let k = 0; k <= nights.length; k++) {
    const morning = k === 0 ? first : nights[k - 1];
    const evening = k < nights.length ? nights[k] : lastRegion;
    days.push({ date: addDays(start, k), regions: new Set([morning, evening]) });
  }
  return days;
}

// Périodes continues aux États-Unis : [{ from, to, days }]
export function usPeriods(days) {
  const out = [];
  days.forEach(d => {
    if (!d.regions.has('US')) return;
    const last = out[out.length - 1];
    if (last && (d.date - last.to) <= DAY * 1.5) { last.to = d.date; last.days++; }
    else out.push({ from: d.date, to: d.date, days: 1 });
  });
  return out;
}

// Jours aux États-Unis dans la fenêtre de 365 jours se terminant à « end » (inclus)
function usInWindow(usKeys, end) {
  let n = 0;
  for (let i = 0; i < 365; i++) if (usKeys.has(key(addDays(end, -i)))) n++;
  return n;
}

// Maximum atteint sur 12 mois glissants pendant le voyage planifié
export function usRollingMax(days) {
  const usKeys = new Set(days.filter(d => d.regions.has('US')).map(d => key(d.date)));
  let max = 0;
  days.forEach(d => { if (d.regions.has('US')) max = Math.max(max, usInWindow(usKeys, d.date)); });
  return max;
}

// Entrée aux États-Unis à « entryIso » et séjour continu : dernier jour possible sans dépasser
// la limite sur 12 mois glissants, en comptant les jours déjà prévus avant cette entrée.
export function latestUsExit(days, entryIso, limit = US_LIMIT) {
  const entry = parseIso(entryIso);
  const usKeys = new Set(days.filter(d => d.regions.has('US') && d.date < entry).map(d => key(d.date)));
  let last = null;
  for (let i = 0; i < 400; i++) {
    const d = addDays(entry, i);
    usKeys.add(key(d));
    if (usInWindow(usKeys, d) > limit) break;
    last = d;
  }
  return last && { last, stay: Math.round((last - entry) / DAY) + 1, before: [...usKeys].filter(k => k < key(entry)).length };
}

// Jours hors Québec dans une année civile : planifiés, et si l'on reste hors Québec jusqu'au 31 décembre
export function qcAbsence(days, year) {
  const inYear = days.filter(d => d.date.getFullYear() === year);
  const planned = inYear.filter(d => !d.regions.has('QC')).length;
  const last = days[days.length - 1];
  const stillAway = last && !last.regions.has('QC');
  let projected = planned;
  if (stillAway && last.date.getFullYear() === year) {
    projected += Math.round((new Date(year, 11, 31) - last.date) / DAY);
  }
  return { planned, projected, stillAway };
}
