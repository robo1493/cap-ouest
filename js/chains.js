// Stationnements de nuit possibles : Walmart, relais routiers, grandes chaînes (Cabela's, Cracker Barrel…).
// Données publiques d'OpenStreetMap (© contributeurs OSM, ODbL), extraites une fois dans chaines.json :
// [lat, lng, code, nom]. On ne garde que les lieux proches du trajet. Rien ne dit qu'un magasin
// accepte la nuit : toujours demander au gérant (règlements municipaux, affiches « No overnight parking »).

import { corridorTest } from './ioverlander.js';

const CORRIDOR_KM = 15;

export const CHAINS = {
  w: { icon: '🛒', color: '#0071ce', label: 'Walmart', tip: 'Nuit souvent tolérée : demander au service à la clientèle ou au gérant. Certains magasins l\'interdisent (règlement municipal).' },
  t: { icon: '🚚', color: '#546e7a', label: 'Relais routier', tip: 'Pilot / Flying J, Love\'s, TA, Petro : stationnement camions, places VR parfois réservées. Demander au comptoir ; ne pas prendre une place de camion.' },
  c: { icon: '🎣', color: '#4e6b2e', label: 'Cabela\'s / Bass Pro', tip: 'Plusieurs ont un stationnement VR et tolèrent la nuit : demander au magasin.' },
  k: { icon: '🍳', color: '#8d6e63', label: 'Cracker Barrel', tip: 'Places autobus / VR à l\'arrière ; nuit souvent permise si on le demande (et qu\'on y mange !).' },
  r: { icon: '🚐', color: '#00838f', label: 'Camping World', tip: 'Certains permettent une nuit, parfois avec branchement : téléphoner avant.' },
  a: { icon: '🍁', color: '#c62828', label: 'Canadian Tire', tip: 'Au Canada, nuit parfois tolérée selon le magasin : demander au gérant.' },
};

let all = null, loading = null;
// Le fichier n'est chargé qu'une fois (et gardé par le service worker pour le hors-réseau)
export function loadChains() {
  return loading ||= fetch('chaines.json').then(r => r.json()).then(list => (all = list)).catch(e => { loading = null; throw e; });
}

// Lieux à moins de 15 km du trajet (null tant que le fichier n'est pas chargé)
export function chainsNear(legs, steps) {
  if (!all || !legs.length) return null;
  const near = corridorTest(legs, steps, CORRIDOR_KM);
  return all.filter(x => near({ lat: x[0], lng: x[1] }));
}
