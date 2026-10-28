// Calcul des tronçons routiers, un tronçon par paire d'étapes.
// - Sans clé : OSRM public (vraies routes, profil auto, aucune restriction VR)
// - Avec clé OpenRouteService : profil poids lourd avec hauteur, longueur, largeur et poids
// Les tronçons calculés sont gardés en cache sur l'appareil (polyligne encodée, compacte),
// donc seuls les tronçons touchés par une modification sont recalculés.

import { hav, decodePolyline } from './geo.js';

const CACHE_KEY = 'capouest.routes.v1';
const CACHE_MAX = 400;
const ROAD_FACTOR = 1.2;

export const PROVIDER_LABEL = {
  ors: 'OpenRouteService · poids lourd',
  'ors-car': 'OpenRouteService · auto (zone fermée aux poids lourds, VR permis)',
  osrm: 'OSRM · profil auto (sans restrictions VR)',
  estimate: 'estimation à vol d\'oiseau × 1,2',
  ferry: 'traversier',
};

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { cache = {}; }

function persist() {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* stockage plein : le cache reste en mémoire */ }
}

export const providerOf = opts => opts.orsKey ? 'ors' : 'osrm';

const r5 = p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
function keyFor(a, b, opts) {
  const p = providerOf(opts);
  const v = p === 'ors' ? '|' + Object.values(opts.vehicle).join(',') : '';
  return `${p}|${r5(a)}|${r5(b)}${v}`;
}

export function estimate(a, b) {
  return { coords: [[a.lat, a.lng], [b.lat, b.lng]], km: hav(a, b) * ROAD_FACTOR, h: null, provider: 'estimate' };
}

// Tronçon en traversier : ligne droite, sans distance routière (ni carburant)
export const ferryLeg = (a, b) => ({ coords: [[a.lat, a.lng], [b.lat, b.lng]], km: 0, h: 1.6, provider: 'ferry' });

// Synchrone : le tronçon en cache, sinon une estimation marquée « pending »
export function cachedOrEstimate(a, b, opts) {
  if (b.extra?.ferry) return ferryLeg(a, b);
  const c = cache[keyFor(a, b, opts)];
  if (c) return { coords: decodePolyline(c.poly), km: c.km, h: c.h, provider: c.provider };
  return { ...estimate(a, b), pending: true };
}

async function osrm(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}`);
  const rt = j.routes[0];
  return { poly: rt.geometry, km: rt.distance / 1000, h: rt.duration / 3600 };
}

async function ors(a, b, opts, profile = 'driving-hgv') {
  const v = opts.vehicle;
  const body = { coordinates: [[a.lng, a.lat], [b.lng, b.lat]] };
  if (profile === 'driving-hgv') {
    body.options = {
      vehicle_type: 'hgv',
      profile_params: { restrictions: { height: v.heightM, length: v.lengthM, width: v.widthM, weight: v.weightT } },
    };
  }
  const r = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/json`, {
    method: 'POST',
    headers: { 'Authorization': opts.orsKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `ORS HTTP ${r.status}`;
    try { msg += ' · ' + ((await r.json()).error?.message || ''); } catch {}
    const err = new Error(msg);
    err.unroutable = /routable point/i.test(msg);
    throw err;
  }
  const rt = (await r.json()).routes[0];
  return { poly: rt.geometry, km: rt.summary.distance / 1000, h: rt.summary.duration / 3600 };
}

// ORS (API publique) ne cherche une route qu'à 350 m autour d'un point. Si une étape est plus loin
// (au milieu d'un parc, par exemple), on la rattache d'abord à la route la plus proche avec OSRM.
async function nearestRoad(p) {
  const r = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${p.lng},${p.lat}?number=1`);
  const j = await r.json();
  if (j.code !== 'Ok') return p;
  const [lng, lat] = j.waypoints[0].location;
  return { lat, lng };
}

// Si le point reste hors du réseau poids lourd (ex. routes de Yellowstone, interdites aux camions
// commerciaux mais permises aux VR), on calcule ce tronçon avec le profil auto et on le signale.
async function orsWithSnap(a, b, opts) {
  try {
    return await ors(a, b, opts);
  } catch (e) {
    if (!e.unroutable) throw e;
  }
  const [sa, sb] = [await nearestRoad(a), await nearestRoad(b)];
  try {
    return await ors(sa, sb, opts);
  } catch (e) {
    if (!e.unroutable) throw e;
  }
  return { ...(await ors(a, b, opts, 'driving-car')), provider: 'ors-car' };
}

// Calcule les tronçons absents du cache, un à la fois (le serveur OSRM public demande ~1 requête/s).
// onLeg(i, leg) est appelé pour chaque tronçon i (de steps[i] à steps[i+1]).
// isStale() permet d'abandonner si l'itinéraire a changé entre-temps.
export async function fetchMissing(steps, opts, { onLeg, onError, isStale }) {
  const p = providerOf(opts);
  for (let i = 1; i < steps.length; i++) {
    if (isStale()) return;
    const a = steps[i - 1], b = steps[i], k = keyFor(a, b, opts);
    if (cache[k] || b.extra?.ferry) continue;   // traversier : pas de calcul routier
    try {
      const res = p === 'ors' ? await orsWithSnap(a, b, opts) : await osrm(a, b);
      const provider = res.provider || p;
      cache[k] = { poly: res.poly, km: res.km, h: res.h, provider };
      persist();
      if (isStale()) return;
      onLeg(i - 1, { coords: decodePolyline(res.poly), km: res.km, h: res.h, provider });
    } catch (e) {
      onError?.(i - 1, e);
    }
    // OSRM public : ~1 requête/s ; ORS gratuit : 40 calculs/min (le repli « rattacher à la route » en coûte plus)
    await new Promise(r => setTimeout(r, p === 'osrm' ? 1000 : 1600));
  }
}

// Chemin ponctuel (ex. retour au trajet après un détour), sans cache
export async function routeOnce(a, b, opts) {
  const p = providerOf(opts);
  const res = p === 'ors' ? await orsWithSnap(a, b, opts) : await osrm(a, b);
  return { coords: decodePolyline(res.poly), km: res.km, h: res.h, provider: res.provider || p };
}

// Vérifie une clé ORS sur un court trajet (Lévis → Québec)
export async function testOrs(orsKey, vehicle) {
  const res = await ors({ lat: 46.80, lng: -71.18 }, { lat: 46.81, lng: -71.21 }, { orsKey, vehicle });
  return res.km;
}

export function clearRouteCache() {
  cache = {};
  persist();
}
