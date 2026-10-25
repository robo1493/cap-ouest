// Points d'intérêt sur la route (OpenStreetMap via Overpass, sans clé) :
// sentiers de marche en forêt, points de vue et chutes, musées, lieux historiques.
//
// Règles de distance (choisies par l'utilisateur) :
// - autour d'une étape : 10 km, ou 25 km quand la fifth wheel peut rester sur place (camping, ou permis)
// - en route : détour de 15 km au plus, seulement si accessible avec le rig
//   (stationnement grand véhicule à proximité, ou halte directement en bordure de route)
// - les autres sont gardés « à vérifier » et masqués par défaut
//
// Les lieux bruts de chaque tronçon sont gardés en cache ; le classement est recalculé à l'affichage.

import { hav } from './geo.js';
import { overpass, boxes, project } from './overpass.js';

const CACHE_KEY = 'capouest.pois.v1';
const CACHE_MAX = 120;
const CORRIDOR_KM = 15;       // détour maximal en route
const STOP_FETCH_KM = 25;     // rayon téléchargé autour des étapes (filtré ensuite à 10 ou 25 km)
const BOX_KM = 80;
const LEGS_PER_QUERY = 1;     // ~40 s par boîte de 80 km sur le serveur public : un tronçon par requête
const RIG_PARKING_KM = 0.4;   // stationnement grand véhicule à moins de 400 m
const ROADSIDE_KM = 1;        // halte en bordure de route : pas de détour réel

export const CATS = {
  trail: { icon: '🥾', label: 'Sentiers et nature' },
  view: { icon: '🏞', label: 'Points de vue et chutes' },
  museum: { icon: '🏛', label: 'Musées' },
  history: { icon: '📜', label: 'Histoire' },
};

export const stopRadiusKm = s => leaveRigAt(s) ? 25 : 10;
// Par défaut, la fifth wheel peut rester sur place au camping et à destination
export const leaveRigAt = s => s.leaveRig ?? (s.type === 'c' || s.type === 'dest');

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { cache = {}; }

function persist() {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* stockage plein : le cache reste en mémoire */ }
}

const r5 = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const keyFor = leg => `${r5(leg.coords[0])}|${r5(leg.coords[leg.coords.length - 1])}|${leg.coords.length}`;
const usable = leg => !leg.pending && leg.provider !== 'estimate' && leg.coords.length > 2;
const cached = leg => usable(leg) ? cache[keyFor(leg)] || null : null;

// Filtres Overpass : notables (Wikidata) pour l'histoire et les grands espaces naturels,
// tous les lieux nommés pour les points de vue, chutes, musées et départs de sentier.
const FILTERS = [
  'nwr["tourism"~"^(viewpoint|museum)$"]["name"]',
  'nwr["natural"="waterfall"]["name"]',
  'nwr["highway"="trailhead"]["name"]',
  'nwr["leisure"="nature_reserve"]["name"]["wikidata"]',
  'nwr["boundary"~"^(national_park|protected_area)$"]["name"]["wikidata"]',
  'nwr["historic"]["name"]["wikidata"]',
  // Une clause par étiquette : un filtre « toutes clés » (regex) fait expirer le serveur
  ...['hgv', 'bus', 'motorhome', 'caravan'].map(k => `nwr["amenity"="parking"]["${k}"~"^(yes|designated)$"]`),
];

function query(batch) {
  const areas = batch.flatMap(({ leg, stops }) => [
    ...boxes(leg.coords, CORRIDOR_KM, BOX_KM).map(b => `(${b})`),
    ...stops.map(s => `(around:${STOP_FETCH_KM * 1000},${s.lat.toFixed(4)},${s.lng.toFixed(4)})`),
  ]);
  const parts = areas.flatMap(a => FILTERS.map(f => f + a + ';')).join('');
  return `[out:json][timeout:240];(${parts});out center tags;`;
}

function category(t) {
  if (t.amenity === 'parking') return 'parking';
  if (t.tourism === 'viewpoint' || t.natural === 'waterfall') return 'view';
  if (t.tourism === 'museum') return 'museum';
  if (t.highway === 'trailhead' || t.leisure === 'nature_reserve' || t.boundary) return 'trail';
  if (t.historic) return 'history';
  return null;
}

// On ne garde que les étiquettes utiles, en format compact
function compact(el) {
  const t = el.tags || {};
  return {
    id: `${el.type[0]}${el.id}`,
    lat: el.lat ?? el.center?.lat,
    lng: el.lon ?? el.center?.lon,
    c: category(t),
    n: t['name:fr'] || t.name || '',
    wd: t.wikidata || '',
    wp: t.wikipedia || '',
    web: t.website || t['contact:website'] || '',
    d: (t['description:fr'] || t.description || '').slice(0, 240),
    h: t.historic || '',
  };
}

// Télécharge les lieux des tronçons absents du cache (corridor du tronçon + cercle autour de ses étapes)
export async function fetchMissingPois(legs, steps, { onLeg, onError, isStale }) {
  const missing = legs.map((leg, i) => ({ leg, i, stops: i === 0 ? [steps[0], steps[1]] : [steps[i + 1]] }))
    .filter(({ leg }) => usable(leg) && !cache[keyFor(leg)]);
  for (let k = 0; k < missing.length; k += LEGS_PER_QUERY) {
    if (isStale()) return;
    const batch = missing.slice(k, k + LEGS_PER_QUERY);
    try {
      const found = (await overpass(query(batch))).map(compact).filter(p => p.lat != null && p.c);
      batch.forEach(({ leg, stops }) => {
        cache[keyFor(leg)] = found.filter(p =>
          stops.some(s => hav(s, p) <= STOP_FETCH_KM) || project(p, leg.coords).off <= CORRIDOR_KM + 0.5);
      });
      persist();
      if (isStale()) return;
      batch.forEach(({ i }) => onLeg(i));
    } catch (e) {
      batch.forEach(({ i }) => onError?.(i, e));
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

export const poiProgress = legs => ({ done: legs.filter(cached).length, total: legs.filter(usable).length });

// Liste ordonnée des lieux à afficher, avec leur mode d'accès :
// - stop  : autour d'une étape (rayon 10 ou 25 km selon la fifth wheel)
// - route : en route, accessible avec le rig
// - check : en route, accès avec le rig à vérifier
export function poisAlong(legs, steps) {
  const byId = new Map(), parkings = [];
  let kmBefore = 0;
  legs.forEach((leg, li) => {
    (cached(leg) || []).forEach(p => {
      if (p.c === 'parking') { parkings.push(p); return; }
      const pr = project(p, leg.coords);
      const km = kmBefore + pr.along * (leg.km / (pr.total || 1));
      const prev = byId.get(p.id);
      if (!prev || pr.off < prev.off) byId.set(p.id, { ...p, off: pr.off, km, leg: li });
    });
    kmBefore += leg.km;
  });

  const out = [];
  byId.forEach(p => {
    // Étape la plus proche, en tenant compte de son rayon
    let stop = -1, dStop = Infinity;
    steps.forEach((s, i) => {
      const d = hav(s, p);
      if (d <= stopRadiusKm(s) && d < dStop) { stop = i; dStop = d; }
    });
    const rigParking = parkings.some(k => hav(k, p) <= RIG_PARKING_KM);
    let mode;
    if (stop >= 0) mode = 'stop';
    else if (p.off <= CORRIDOR_KM && (rigParking || (p.off <= ROADSIDE_KM && p.c === 'view'))) mode = 'route';
    else if (p.off <= CORRIDOR_KM) mode = 'check';
    else return;
    out.push({ ...p, mode, stop, dStop, rigParking, notable: !!(p.wd || p.wp) });
  });
  return out.sort((a, b) => a.km - b.km);
}

// Lien Wikipédia : l'article indiqué dans OpenStreetMap, sinon l'article français lié à Wikidata
export function wikiLink(p) {
  const m = /^(\w+):(.+)$/.exec(p.wp || '');
  if (m) return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}`;
  if (p.wd) return `https://www.wikidata.org/wiki/Special:GoToLinkedPage/frwiki/${p.wd}`;
  return '';
}

export function clearPoiCache() {
  cache = {};
  persist();
}
