// 🌲 Sites de loisirs de la C.-B. (Recreation Sites and Trails BC) : campings publics rustiques, souvent gratuits ou à petit prix.
// Données ouvertes du gouvernement de la C.-B. (Open Government Licence – British Columbia), couche WFS
// WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW (openmaps.gov.bc.ca), extraite une fois dans bcrec.json (sites avec camping seulement,
// sans noms ni téléphones des exploitants) : [lat, lng, nom, lieu, nb sites, accès ('v' VR, '2' 2 roues motrices, '4' 4x4, 't' sentier / bateau, '?' non précisé),
// entretien ('m' entretenu, 'u' par les usagers), frais ('p' payant, 'g' gratuit, 'u' gratuit probable, '' inconnu), avis de fermeture,
// équipements (FR), activités (FR), id du site (REC…)].

import { corridorTest } from './ioverlander.js';

export const BCR_KM = 40;

let all = null, loading = null;
export function loadBcr() {
  return loading ||= fetch('bcrec.json').then(r => r.json()).then(list => (all = list)).catch(e => { loading = null; throw e; });
}
export const bcrAll = () => all;

// Sites à moins de 40 km du trajet (null tant que le fichier n'est pas chargé)
export function bcrNear(legs, steps) {
  if (!all || !legs.length) return null;
  const near = corridorTest(legs, steps, BCR_KM);
  return all.filter(x => near({ lat: x[0], lng: x[1] }));
}
