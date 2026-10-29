// Passages bas le long du trajet (ponts, tunnels, viaducs, barrières de hauteur) : hauteur libre
// « maxheight » d'OpenStreetMap, via l'API Overpass (sans clé). Données souvent incomplètes :
// une aide, pas une garantie. Les passages bruts de chaque tronçon sont gardés en cache sur
// l'appareil ; le tri selon la hauteur du gabarit est refait à l'affichage.

import { overpass, boxes, project } from './overpass.js';

const CACHE_KEY = 'capouest.clearances.v1';
const CACHE_MAX = 200;
const BOX_PAD_M = 300;      // marge des boîtes de recherche
const ON_ROUTE_M = 60;      // le passage doit être sur notre route (géométrie du trajet ≈ celle d'OSM)
const MAX_ANGLE = 35;       // une route avec hauteur limite qui croise le trajet (sous notre pont) est ignorée
const BOX_KM = 20;
const LEGS_PER_QUERY = 5;
export const MARGIN_M = 0.45;   // ~1' 6" : au-delà de la hauteur du rig + cette marge, pas d'alerte

// Routes où une hauteur libre compte pour nous (pas les stationnements, allées ni bâtiments)
const ROADS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road';

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { cache = {}; }

function persist() {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* stockage plein : le cache reste en mémoire */ }
}

const r5 = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const keyFor = leg => `${r5(leg.coords[0])}|${r5(leg.coords[leg.coords.length - 1])}|${leg.coords.length}`;
const usable = leg => !leg.pending && leg.provider !== 'estimate' && leg.provider !== 'ferry' && leg.coords.length > 2;
const cached = leg => usable(leg) ? cache[keyFor(leg)] || null : null;

// Hauteur en mètres : « 3.5 », « 3.5 m », « 11'6" », « 11 ft 6 in », « 12' » ; null si inconnue
export function parseHeight(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m)?$/);
  if (m) return +m[1];
  m = s.match(/^(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in|inch(?:es)?)?)?$/);
  if (m) return +m[1] * 0.3048 + (m[2] ? +m[2] * 0.0254 : 0);
  return null;
}

// 3,66 m → 12' 0"
export const feet = m => { let ft = Math.floor(m / 0.3048 + 1e-6), inch = Math.round((m - ft * 0.3048) / 0.0254); if (inch >= 12) { ft++; inch -= 12; } return `${ft}' ${inch}"`; };

// Cap (0-180°, sens ignoré) d'un segment, en km locaux
const axis = (a, b) => {
  const kx = Math.cos(a[0] * Math.PI / 180);
  return (Math.atan2((b[1] - a[1]) * kx, b[0] - a[0]) * 180 / Math.PI + 180) % 180;
};
// Cap du trajet au segment le plus proche du point
function routeAxis(p, coords) {
  let best = Infinity, ax = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = (m[0] - p.lat) ** 2 + ((m[1] - p.lng) * Math.cos(p.lat * Math.PI / 180)) ** 2;
    if (d < best && (a[0] !== b[0] || a[1] !== b[1])) { best = d; ax = axis(a, b); }
  }
  return ax;
}
// Sur notre route : assez proche du trajet et, pour une route (way), orientée dans le même sens
function onRoute(c, coords) {
  if (project(c, coords).off > ON_ROUTE_M / 1000) return false;
  if (c.ax == null) return true;
  const diff = Math.abs(c.ax - routeAxis(c, coords));
  return Math.min(diff, 180 - diff) <= MAX_ANGLE;
}

function compact(el) {
  const t = el.tags || {};
  const h = parseHeight(t['maxheight:physical']) ?? parseHeight(t.maxheight);
  if (h === null) return null;
  const g = el.geometry || [];
  const mid = g[Math.floor(g.length / 2)];
  const kind = t.tunnel && t.tunnel !== 'no' ? 'Tunnel' : t.barrier === 'height_restrictor' ? 'Barrière de hauteur'
    : t.bridge && t.bridge !== 'no' ? 'Pont' : t.covered === 'yes' ? 'Passage couvert' : 'Passage sous un pont';
  return {
    id: `${el.type[0]}${el.id}`,
    lat: el.lat ?? mid?.lat,
    lng: el.lon ?? mid?.lon,
    ax: g.length > 1 ? +axis([g[0].lat, g[0].lon], [g[g.length - 1].lat, g[g.length - 1].lon]).toFixed(0) : null,
    h: +h.toFixed(2),
    kind,
    road: t.ref || t.name || '',
  };
}

async function query(legs) {
  // Points : barrières de hauteur et panneaux sur la route (pas les entrées de stationnement)
  const parts = legs.flatMap(l => boxes(l.coords, BOX_PAD_M / 1000, BOX_KM))
    .map(b => `way["maxheight"]["highway"~"^(${ROADS})$"](${b});way["maxheight:physical"]["highway"~"^(${ROADS})$"](${b});node["maxheight"][!"amenity"][!"parking"](${b});`).join('');
  return overpass(`[out:json][timeout:180];(${parts});out tags geom;`);
}

// Télécharge les passages des tronçons absents du cache (une requête à la fois, comme les stations)
export async function fetchMissingClearances(legs, { onLeg, onError, isStale }) {
  const missing = legs.map((leg, i) => ({ leg, i })).filter(({ leg }) => usable(leg) && !cache[keyFor(leg)]);
  for (let k = 0; k < missing.length; k += LEGS_PER_QUERY) {
    if (isStale()) return;
    const batch = missing.slice(k, k + LEGS_PER_QUERY);
    try {
      const found = (await query(batch.map(b => b.leg))).map(compact).filter(c => c && c.lat != null);
      batch.forEach(({ leg }) => { cache[keyFor(leg)] = found.filter(c => onRoute(c, leg.coords)); });
      persist();
      if (isStale()) return;
      batch.forEach(({ i }) => onLeg(i));
    } catch (e) {
      batch.forEach(({ i }) => onError?.(i, e));
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

// Passages trop bas ou serrés pour le rig, dans l'ordre du trajet (km depuis le départ).
// danger : moins de 3 po de marge (ou plus bas que le rig) ; sinon serré (moins de ~1' 6" de marge)
export function clearancesAlong(legs, rigM) {
  const byId = new Map();
  let kmBefore = 0;
  legs.forEach(leg => {
    (cached(leg) || []).forEach(c => {
      if (c.h >= rigM + MARGIN_M || byId.has(c.id)) return;
      const pr = project(c, leg.coords);
      byId.set(c.id, { ...c, km: kmBefore + pr.along * (leg.km / (pr.total || 1)), off: pr.off, danger: c.h < rigM + 0.08 });
    });
    kmBefore += leg.km;
  });
  return [...byId.values()].sort((a, b) => a.km - b.km);
}

export const clearanceProgress = legs => ({ done: legs.filter(l => cached(l)).length, total: legs.filter(usable).length });

export function clearClearanceCache() {
  cache = {};
  persist();
}
