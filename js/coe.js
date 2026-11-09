// 🏛 Campings du Corps of Engineers (USACE) : campings publics au bord des lacs et des rivières des États-Unis.
// Liste publique de recreation.gov, extraite une fois dans coe.json (abris, aires de jour et sites en bateau retirés) :
// [lat, lng, nom, lac, État, id recreation.gov, prix min, prix max]. Plusieurs ferment l'hiver : vérifier la saison.

import { corridorTest } from './ioverlander.js';

export const COE_KM = 40;

let all = null, loading = null;
export function loadCoe() {
  return loading ||= fetch('coe.json').then(r => r.json()).then(list => (all = list)).catch(e => { loading = null; throw e; });
}
export const coeAll = () => all;

// Campings à moins de 40 km du trajet (null tant que le fichier n'est pas chargé)
export function coeNear(legs, steps) {
  if (!all || !legs.length) return null;
  const near = corridorTest(legs, steps, COE_KM);
  return all.filter(x => near({ lat: x[0], lng: x[1] }));
}
