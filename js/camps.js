// Campings et parcs VR, privés et publics, des États-Unis et du Canada.
// Données publiques d'OpenStreetMap (© contributeurs OSM, ODbL), extraites une fois dans campings.json :
// [lat, lng, k, nom, téléphone, site web, services, longueur max]. k : 'v' parc VR, 'c' camping.
// services : e électricité, w eau, d vidange, r réservation, p public, x privé.
// La longueur des emplacements n'y est presque jamais : toujours vérifier la place pour le rig.

import { corridorTest } from './ioverlander.js';

const CORRIDOR_KM = 20;

export const CAMP_KINDS = {
  v: { icon: '🔌', color: '#ad1457', label: 'Parc VR' },
  c: { icon: '🏕', color: '#6a1b9a', label: 'Camping' },
};
export const CAMP_FLAGS = { e: '⚡ électricité', w: '💧 eau', d: '🚽 vidange', r: '📅 réservation' };

let all = null, loading = null;
export function loadCamps() {
  return loading ||= fetch('campings.json').then(r => r.json()).then(list => (all = list)).catch(e => { loading = null; throw e; });
}

// Lieux à moins de 20 km du trajet (null tant que le fichier n'est pas chargé)
export function campsNear(legs, steps) {
  if (!all || !legs.length) return null;
  const near = corridorTest(legs, steps, CORRIDOR_KM);
  return all.filter(x => near({ lat: x[0], lng: x[1] }));
}
