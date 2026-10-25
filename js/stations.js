// Stations diesel réelles le long du trajet (OpenStreetMap, via l'API Overpass, sans clé)
// et niveau de facilité pour l'ensemble camion + fifth wheel (~55', 12' 4").
// Les stations brutes de chaque tronçon sont gardées en cache sur l'appareil ;
// le classement est recalculé à l'affichage (on peut ajuster les règles sans tout retélécharger).

import { hav } from './geo.js';
import { overpass as runOverpass, boxes, project } from './overpass.js';

const CACHE_KEY = 'capouest.stations.v1';
const CACHE_MAX = 200;
const RADIUS_M = 2000;      // corridor de recherche autour du trajet
const BOX_KM = 20;          // longueur de route par boîte de recherche
const LEGS_PER_QUERY = 5;   // tronçons regroupés par requête
const URBAN_KM = 1.2;       // 2 autres stations ou plus dans ce rayon = secteur urbain

export const LEVEL = {
  1: { label: 'Facile', color: '#2e8b3d', desc: 'Relais routier ou voie camion' },
  2: { label: 'Faisable', color: '#d4a106', desc: 'Station hors ville, près du trajet' },
  3: { label: 'Serré', color: '#e0661b', desc: 'Station en ville ou à l\'écart du trajet' },
  0: { label: 'Cardlock', color: '#8a8a86', desc: 'Carte commerciale requise' },
};

// Chaînes de relais routiers (voies camion / VR, grands terrains)
const TRUCKSTOP = /flying\s*j|pilot\s*(travel|flying)|^pilot$|love'?s|travel\s*cent(er|re)s?|petro\s*stopping|truck\s*stop|truck\s*plaza|travel\s*plaza|husky\s*travel|road\s*king|sapp\s*bros|bosselman|big\s*rig/i;
const CARDLOCK = /card\s*-?lock|petro[\s-]*pass|\bcommercial\b|fleet\s*fuel/i;
// Bannières qui vendent presque toujours du diesel le long des grands axes (à confirmer sur place)
const DIESEL_BRANDS = /petro-?canada|esso|shell|husky|irving|ultramar|co-?op|fas\s*gas|chevron|cenex|conoco|sinclair|exxon|maverik|holiday|phillips\s*66|town\s*pump|kum\s*&\s*go|casey'?s/i;

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

export const cachedStations = leg => usable(leg) ? cache[keyFor(leg)] || null : null;

async function overpass(legs) {
  const parts = legs.flatMap(l => boxes(l.coords, RADIUS_M / 1000, BOX_KM)).map(b => `nwr["amenity"="fuel"](${b});`).join('');
  return runOverpass(`[out:json][timeout:180];(${parts});out center tags;`);
}

// On ne garde que les étiquettes utiles, en format compact
function compact(el) {
  const t = el.tags || {};
  const yes = v => v === 'yes' || v === 'designated';
  return {
    id: `${el.type[0]}${el.id}`,
    lat: el.lat ?? el.center?.lat,
    lng: el.lon ?? el.center?.lon,
    n: t.name || '',
    b: t.brand || '',
    o: t.operator || '',
    d: t['fuel:diesel'] === 'yes' ? 'y' : t['fuel:diesel'] === 'no' ? 'n' : '?',
    hd: yes(t['fuel:HGV_diesel']) ? 1 : 0,
    hgv: yes(t.hgv) ? 1 : 0,
    def: yes(t['fuel:adblue']) || yes(t['fuel:def']) ? 1 : 0,
  };
}

// Télécharge les stations des tronçons absents du cache, par lots de LEGS_PER_QUERY tronçons
// (une requête à la fois : serveur public partagé). Chaque tronçon garde les stations de son corridor.
export async function fetchMissingStations(legs, { onLeg, onError, isStale }) {
  const missing = legs.map((leg, i) => ({ leg, i })).filter(({ leg }) => usable(leg) && !cache[keyFor(leg)]);
  for (let k = 0; k < missing.length; k += LEGS_PER_QUERY) {
    if (isStale()) return;
    const batch = missing.slice(k, k + LEGS_PER_QUERY);
    try {
      const found = (await overpass(batch.map(b => b.leg))).map(compact).filter(s => s.lat != null);
      batch.forEach(({ leg }) => {
        cache[keyFor(leg)] = found.filter(s => project(s, leg.coords).off <= RADIUS_M / 1000 + 0.5);
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

function classify(s, urban) {
  const label = `${s.n} ${s.b} ${s.o}`;
  const why = [];
  if (CARDLOCK.test(label)) return { level: 0, why: ['Cardlock : carte commerciale requise'] };
  const truck = TRUCKSTOP.test(label) || /^TA$/i.test(s.b);
  if (truck) why.push('Relais routier connu');
  if (s.hd) why.push('Diesel poids lourd');
  if (s.hgv) why.push('Accès poids lourds');
  if (truck || s.hd || s.hgv) return { level: 1, why };
  if (urban) why.push('Secteur urbain (plusieurs stations proches)');
  if (s.off > 1) why.push(`À ${s.off.toFixed(1).replace('.', ',')} km du trajet`);
  return { level: urban || s.off > 1 ? 3 : 2, why: why.length ? why : ['Diesel, hors ville, en bordure du trajet'] };
}

// Liste ordonnée des stations diesel le long du trajet, avec km, distance et niveau
export function stationsAlong(legs) {
  const byId = new Map();
  let kmBefore = 0;
  legs.forEach((leg, li) => {
    const list = cachedStations(leg);
    if (list) {
      list.forEach(s => {
        const pr = project(s, leg.coords);
        const km = kmBefore + pr.along * (leg.km / (pr.total || 1));
        const prev = byId.get(s.id);
        if (!prev || pr.off < prev.off) byId.set(s.id, { ...s, off: pr.off, km, leg: li });
      });
    }
    kmBefore += leg.km;
  });

  // Une même station est parfois dessinée deux fois (point + contour) : même nom à moins de 200 m
  const all = [];
  [...byId.values()].filter(s => s.off <= RADIUS_M / 1000 + 0.5).forEach(s => {
    const twin = all.find(o => hav(o, s) < 0.2 && (o.n || o.b) === (s.n || s.b));
    if (!twin) { all.push(s); return; }
    ['d', 'hd', 'hgv', 'def'].forEach(k => { if (twin[k] === '?' || !twin[k]) twin[k] = s[k]; });
  });
  // Diesel confirmé, relais routier / poids lourd (le diesel y est sûr), ou grande bannière
  // dont le diesel n'est pas indiqué dans OpenStreetMap (à confirmer) ; jamais « diesel=no »
  const out = [];
  all.forEach(s => {
    const label = `${s.n} ${s.b} ${s.o}`;
    const heavy = s.hd || s.hgv || TRUCKSTOP.test(label) || /^TA$/i.test(s.b);
    if (s.d === 'n' && !s.hd) return;
    const unsure = s.d !== 'y' && !heavy;
    if (unsure && !DIESEL_BRANDS.test(label)) return;
    const near = all.filter(o => o !== s && hav(o, s) <= URBAN_KM).length;
    const c = classify(s, near >= 2);
    if (unsure && c.level) c.why.push('Diesel non confirmé dans OpenStreetMap');
    out.push({ ...s, ...c, unsure, name: s.n || s.b || s.o || 'Station sans nom' });
  });
  return out.sort((a, b) => a.km - b.km);
}

// Nombre de tronçons dont les stations sont chargées
export const stationProgress = legs => ({ done: legs.filter(l => cachedStations(l)).length, total: legs.filter(usable).length });

export function clearStationCache() {
  cache = {};
  persist();
}
