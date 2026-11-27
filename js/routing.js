// Calcul des tronçons routiers, un tronçon par paire d'étapes.
// - Sans clé : OSRM public (vraies routes, profil auto, aucune restriction VR)
// - Avec clé OpenRouteService : profil poids lourd avec hauteur, longueur, largeur et poids
// Les tronçons calculés sont gardés en cache sur l'appareil (polyligne encodée, compacte),
// donc seuls les tronçons touchés par une modification sont recalculés.

import { loadCache, saveCache } from './kv.js';
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
// Chargé depuis IndexedDB (kv.js) : attendre « ready » avant d'utiliser le cache
export const ready = loadCache(CACHE_KEY).then(c => { cache = { ...c, ...cache }; });

function persist() {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
  saveCache(CACHE_KEY, cache);
}

export const providerOf = opts => opts.orsKey ? 'ors' : 'osrm';
// 🛣️ « Route directe » (extra.direct de l'étape d'arrivée, v1.55) : ce tronçon est calculé avec OSRM même si une clé ORS
// est saisie, quand le profil poids lourds d'ORS fait un détour absurde (ex. pont tournant de Reedsport sur la 101, 14′ 6″).
// Les ponts et passages bas restent vérifiés sur le tracé (clearances.js).
export const legOpts = (b, opts) => b?.extra?.direct && opts.orsKey ? { ...opts, orsKey: '' } : opts;

const r5 = p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
function keyFor(a, b, opts) {
  const p = providerOf(opts);
  const v = p === 'ors' ? '|' + Object.values(opts.vehicle).join(',') : '';
  return `${p}|${r5(a)}|${r5(b)}${v}`;
}

// Le tracé part bien de a et arrive bien à b (à 5 km près : rattachement à la route la plus proche)
const ENDS_KM = 5;
const endsOk = (coords, a, b) => coords.length > 1
  && hav({ lat: coords[0][0], lng: coords[0][1] }, a) < ENDS_KM
  && hav({ lat: coords[coords.length - 1][0], lng: coords[coords.length - 1][1] }, b) < ENDS_KM;

export function estimate(a, b) {
  return { coords: [[a.lat, a.lng], [b.lat, b.lng]], km: hav(a, b) * ROAD_FACTOR, h: null, provider: 'estimate' };
}

// Tronçon en traversier : ligne droite, sans distance routière (ni carburant)
export const ferryLeg = (a, b) => ({ coords: [[a.lat, a.lng], [b.lat, b.lng]], km: 0, h: 1.6, provider: 'ferry' });

// Traversier avec quais connus (extra.ferryFrom / extra.ferryTo = { name, lat, lng }) :
// route jusqu'au quai de départ, traversée, puis route du quai d'arrivée jusqu'à l'étape.
const FERRY_H = 1.6;
export const FERRY_PORTS = {
  tsa: { name: 'Tsawwassen', lat: 49.00794, lng: -123.12909 },
  swa: { name: 'Swartz Bay (Victoria)', lat: 48.68654, lng: -123.41052 },
  hsb: { name: 'Horseshoe Bay', lat: 49.36856, lng: -123.2759 },
  dep: { name: 'Departure Bay (Nanaimo)', lat: 49.1913, lng: -123.95379 },
  duk: { name: 'Duke Point (Nanaimo)', lat: 49.15666, lng: -123.89101 },
};
export const FERRY_ROUTES = [['tsa', 'swa'], ['swa', 'tsa'], ['hsb', 'dep'], ['dep', 'hsb'], ['tsa', 'duk'], ['duk', 'tsa']];
const AUTO_MAX_KM = 250;   // quai choisi automatiquement seulement s'il est à moins de 250 km (vol d'oiseau) des étapes
// Quais [départ, arrivée] du tronçon a → b : ceux choisis dans la fiche, sinon la traversée connue
// qui fait le moins de route ; null = traversier en ligne droite (aucune traversée connue près d'ici)
export function ferryTerminals(b, a) {
  if (!b.extra?.ferry) return null;
  const f = b.extra.ferryFrom, t = b.extra.ferryTo;
  if (Number.isFinite(f?.lat) && Number.isFinite(t?.lat)) return [f, t];
  if (!a) return null;
  let best = null, bestKm = Infinity;
  for (const [x, y] of FERRY_ROUTES) {
    const px = FERRY_PORTS[x], py = FERRY_PORTS[y], d1 = hav(a, px), d2 = hav(py, b);
    if (d1 < AUTO_MAX_KM && d2 < AUTO_MAX_KM && d1 + d2 < bestKm) { bestKm = d1 + d2; best = [px, py]; }
  }
  return best;
}
function composeFerry(r1, f, t, r2) {
  const cross = { coords: [[f.lat, f.lng], [t.lat, t.lng]], provider: 'ferry' };
  return {
    coords: [...r1.coords, ...cross.coords, ...r2.coords],
    km: r1.km + r2.km,
    h: r1.h == null || r2.h == null ? null : r1.h + FERRY_H + r2.h,
    provider: r1.provider === r2.provider ? r1.provider : r1.provider === 'estimate' ? r1.provider : r2.provider,
    ferry: true, ferryFrom: f.name, ferryTo: t.name,
    parts: [r1, cross, r2],
    ...(r1.pending || r2.pending ? { pending: true } : {}),
  };
}

// Synchrone : le tronçon en cache, sinon une estimation marquée « pending »
export function cachedOrEstimate(a, b, opts) {
  opts = legOpts(b, opts);
  const ft = ferryTerminals(b, a);
  if (ft) return composeFerry(roadCachedOrEstimate(a, ft[0], opts), ft[0], ft[1], roadCachedOrEstimate(ft[1], b, opts));
  if (b.extra?.ferry) return ferryLeg(a, b);
  return roadCachedOrEstimate(a, b, opts);
}

function roadCachedOrEstimate(a, b, opts) {
  const k = keyFor(a, b, opts), c = cache[k];
  if (c) {
    const coords = decodePolyline(c.poly);
    if (endsOk(coords, a, b)) return { coords, km: c.km, h: c.h, provider: c.provider };
    delete cache[k];   // tracé qui ne va pas jusqu'aux étapes : à recalculer
  }
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
export async function nearestRoad(p) {
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
  try {
    return { ...(await ors(sa, sb, opts, 'driving-car')), provider: 'ors-car' };
  } catch (e) {
    if (!e.unroutable) throw e;
  }
  // Étape loin de toute route connue d'ORS (ex. en plein désert) : OSRM rattache le point à la route la plus proche
  return { ...(await osrm(a, b)), provider: 'osrm' };
}

// Calcule les tronçons absents du cache, un à la fois (le serveur OSRM public demande ~1 requête/s).
// onLeg(i, leg) est appelé pour chaque tronçon i (de steps[i] à steps[i+1]).
// isStale() permet d'abandonner si l'itinéraire a changé entre-temps.
export async function fetchMissing(steps, opts, { onLeg, onError, isStale }) {
  const p = providerOf(opts);
  const pause = () => new Promise(r => setTimeout(r, p === 'osrm' ? 1000 : 1600));
  // Calcule et met en cache un tronçon routier a → b ; false s'il était déjà en cache
  async function road(a, b, o) {
    const k = keyFor(a, b, o), p = providerOf(o);
    if (cache[k]) return false;
    let res = p === 'ors' ? await orsWithSnap(a, b, o) : await osrm(a, b);
    // Tracé ORS qui n'arrive pas à l'étape : refaire avec OSRM
    if (!endsOk(decodePolyline(res.poly), a, b) && p === 'ors') res = { ...(await osrm(a, b)), provider: 'osrm' };
    if (!endsOk(decodePolyline(res.poly), a, b)) throw new Error('Tracé qui n’arrive pas à l’étape');
    cache[k] = { poly: res.poly, km: res.km, h: res.h, provider: res.provider || p };
    persist();
    return true;
  }
  for (let i = 1; i < steps.length; i++) {
    if (isStale()) return;
    const a = steps[i - 1], b = steps[i], ft = ferryTerminals(b, a);
    if (b.extra?.ferry && !ft) continue;   // traversier sans quais : pas de calcul routier
    const pairs = ft ? [[a, ft[0]], [ft[1], b]] : [[a, b]];
    try {
      let fetched = false;
      for (const [x, y] of pairs) {
        if (await road(x, y, legOpts(b, opts))) { fetched = true; if (isStale()) return; await pause(); }
      }
      if (fetched) onLeg(i - 1, cachedOrEstimate(a, b, opts));
    } catch (e) {
      onError?.(i - 1, e);
      // OSRM public : ~1 requête/s ; ORS gratuit : 40 calculs/min (le repli « rattacher à la route » en coûte plus)
      await pause();
    }
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
