// 📅 Aide à la réservation : paramètres du rig (modifiables dans ⚙ Paramètres), dates tirées de l'itinéraire,
// texte prêt à copier (français + anglais) et lien vers le bon site de réservation selon le type d'endroit.
// La réservation et le paiement se font toujours par l'utilisateur, sur le site officiel.

export const RESV_DEFAULT = {
  equip: 'fifth', trailerFt: 35, totalFt: 55, amps: '50', hookups: 'full',
  adults: 2, kids: 0, pets: 0, vehicles: 1, slides: 3, pull: true, note: '',
};
export const RESV_EQUIP = { fifth: ['Fifth wheel', 'Fifth Wheel'], trailer: ['Roulotte', 'Travel Trailer'], motor: ['Motorisé', 'Motorhome / RV'], van: ['Fourgonnette', 'Van'], tent: ['Tente', 'Tent'] };
export const RESV_AMPS = { 50: ['50 A', '50 amp'], 30: ['30 A', '30 amp'], 20: ['20 A', '20 amp'], 0: ['aucune', 'no electric'] };
export const RESV_HOOK = { full: ['complets (eau, électricité, égout)', 'Full hookups'], we: ['eau et électricité', 'Water + electric'], e: ['électricité seulement', 'Electric only'], none: ['aucun (rustique)', 'No hookups'] };

// Sites de réservation des parcs d'État et provinciaux (page d'accueil des réservations)
const STATE = {
  CA: ['ReserveCalifornia', 'https://www.reservecalifornia.com'],
  AZ: ['Arizona State Parks', 'https://azstateparks.com'],
  TX: ['Texas State Parks', 'https://texasstateparks.reserveamerica.com'],
  OR: ['Oregon State Parks', 'https://oregonstateparks.reserveamerica.com'],
  WA: ['Washington State Parks', 'https://washington.goingtocamp.com'],
  NM: ['New Mexico State Parks', 'https://newmexicostateparks.reserveamerica.com'],
  FL: ['Florida State Parks', 'https://floridastateparks.reserveamerica.com'],
  GA: ['Georgia State Parks', 'https://gastateparks.reserveamerica.com'],
  AL: ['Alabama State Parks', 'https://www.alapark.com'],
  LA: ['Louisiana State Parks', 'https://www.lastateparks.com'],
  NV: ['Nevada State Parks', 'https://parks.nv.gov'],
  UT: ['Utah State Parks', 'https://utahstateparks.reserveamerica.com'],
  SD: ['South Dakota (campSD)', 'https://campsd.com'],
  MT: ['Montana State Parks', 'https://stateparks.mt.gov'],
  WY: ['Wyoming State Parks', 'https://wyoparks.wyo.gov'],
  ND: ['North Dakota Parks', 'https://www.parkrec.nd.gov'],
  BC: ['BC Parks', 'https://camping.bcparks.ca'],
  AB: ['Alberta Parks', 'https://reserve.albertaparks.ca'],
  MB: ['Manitoba Parks', 'https://manitobaparks.goingtocamp.com'],
  ON: ['Ontario Parks', 'https://reservations.ontarioparks.ca'],
  QC: ['Sépaq', 'https://www.sepaq.com'],
};
const CA_PROV = ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'];
const google = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);

// Le bon site selon l'endroit. coe : campings du Corps (coe.json) pour reconnaître un camping de recreation.gov.
export function resvSites(s, coe) {
  const name = s.name || '', code = (name.match(/,\s*([A-Z]{2})\s*$/) || [])[1] || '';
  const place = name.replace(/,\s*[A-Z]{2}\s*$/, '').trim();
  const out = [];
  const near = (coe || []).find(x => Math.abs(x[0] - s.lat) < 0.012 && Math.abs(x[1] - s.lng) < 0.012);
  if (near) out.push(['recreation.gov – ' + near[2], 'https://www.recreation.gov/camping/campgrounds/' + near[5]]);
  else if (/corps of engineers|\bcoe\b|national forest|forêt nationale|forest service|\bnps?\b|national park|parc national/i.test(name) && !CA_PROV.includes(code))
    out.push(['recreation.gov', 'https://www.recreation.gov/search?q=' + encodeURIComponent(place)]);
  if (CA_PROV.includes(code) && /parc national|national park/i.test(name) && !/québec|sépaq/i.test(name))
    out.push(['Parcs Canada', 'https://reservation.pc.gc.ca']);
  else if (/parc d.?état|state park|state beach|state recreation|\bS[PB]\b|\bSRA\b|parc provincial|provincial park|\bPP\b|sépaq|parc national du québec/i.test(name) && STATE[code])
    out.push(STATE[code]);
  out.push(['Chercher sur Google', google(place + ' camping reservations')]);
  return out;
}

const n = (v, one, many) => `${v} ${v > 1 ? many : one}`;
export function resvText(s, arrIso, depIso, nights, p) {
  const eq = RESV_EQUIP[p.equip] || RESV_EQUIP.fifth, a = RESV_AMPS[p.amps] || RESV_AMPS[50], h = RESV_HOOK[p.hookups] || RESV_HOOK.full;
  const fr = [
    `Endroit : ${s.name}`,
    `Arrivée : ${arrIso} · Départ : ${depIso} (${n(nights, 'nuit', 'nuits')})`,
    `Équipement : ${eq[0]} ${p.trailerFt} pi (longueur totale avec le camion : ${p.totalFt} pi)`,
    `Électricité : ${a[0]} · Branchements : ${h[0]}${p.pull ? ' · site traversant (pull-through) de préférence' : ''}`,
    `Personnes : ${n(p.adults, 'adulte', 'adultes')}${p.kids ? ', ' + n(p.kids, 'enfant', 'enfants') : ''} · Animaux : ${p.pets} · Véhicules : ${p.vehicles} · Extensions : ${p.slides}`,
    p.note ? `Note : ${p.note}` : '',
  ];
  const en = [
    `Arrival ${arrIso} · Departure ${depIso} (${nights} night${nights > 1 ? 's' : ''})`,
    `${eq[1]}, ${p.trailerFt} ft (total length with truck ${p.totalFt} ft) · ${a[1]} · ${h[1]}${p.pull ? ' · pull-through preferred' : ''}`,
    `${p.adults} adult${p.adults > 1 ? 's' : ''}${p.kids ? `, ${p.kids} child${p.kids > 1 ? 'ren' : ''}` : ''} · ${p.pets} pet${p.pets !== 1 ? 's' : ''} · ${p.vehicles} vehicle${p.vehicles > 1 ? 's' : ''} · ${p.slides} slide-out${p.slides !== 1 ? 's' : ''}`,
  ];
  return [...fr.filter(Boolean), '', 'In English:', ...en].join('\n');
}
