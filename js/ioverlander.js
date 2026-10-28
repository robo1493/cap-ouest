// Lieux iOverlander : export CSV personnel de l'utilisateur (abonné), jamais publié.
// Colonnes du fichier : Latitude, Longitude, Name, Category.
// À l'import, on ne garde que les catégories utiles au voyage et les lieux proches du trajet
// (corridor de 40 km), puis le lot est synchronisé de façon privée par Supabase (table places).

import { hav } from './geo.js';

const KEY = 'capouest.ioverlander.v1';
const DIRTY_KEY = 'capouest.ioverlander.dirty';
export const PACK_ID = '__ioverlander__';
const CORRIDOR_KM = 40;

// Catégories gardées : k = code court, g = groupe d'affichage
export const IO_CATS = {
  'Wild Camping': { k: 'wild', g: 'night', icon: '⛺', color: '#2e8b3d', label: 'Camping sauvage' },
  'Informal Campsite': { k: 'informal', g: 'night', icon: '⛺', color: '#7cb342', label: 'Camping informel' },
  'Established Campground': { k: 'camp', g: 'night', icon: '🏕', color: '#3d6fb4', label: 'Camping aménagé' },
  'Farm & Vineyard Camping': { k: 'farm', g: 'night', icon: '🍇', color: '#8e24aa', label: 'Ferme ou vignoble' },
  'Water': { k: 'water', g: 'serv', icon: '💧', color: '#1e88e5', label: 'Eau potable' },
  'Sanitation Dump Station': { k: 'dump', g: 'serv', icon: '🚽', color: '#795548', label: 'Vidange' },
  'Propane': { k: 'propane', g: 'serv', icon: '🔥', color: '#f57c00', label: 'Propane' },
  'Showers': { k: 'shower', g: 'serv', icon: '🚿', color: '#26a69a', label: 'Douches' },
  'Laundromat': { k: 'laundry', g: 'serv', icon: '🧺', color: '#5c6bc0', label: 'Buanderie' },
  'Mechanic and Parts': { k: 'mech', g: 'serv', icon: '🔧', color: '#616161', label: 'Mécanique' },
  'Overnight Prohibited': { k: 'nope', g: 'warn', icon: '🚫', color: '#c62828', label: 'Nuit interdite' },
  'Warning': { k: 'warn', g: 'warn', icon: '⚠', color: '#c62828', label: 'Avertissement' },
  'Road Report': { k: 'road', g: 'warn', icon: '⚠', color: '#e65100', label: 'État de la route' },
};
export const BY_K = Object.fromEntries(Object.values(IO_CATS).map(c => [c.k, c]));
export const GROUPS = {
  night: '⛺ Nuits (sauvage, informel, campings)',
  serv: '💧 Services (eau, vidange, propane…)',
  warn: '🚫 Nuit interdite et avertissements',
};

// Les lieux sont gardés dans IndexedDB : localStorage (~5 Mo, partagé avec les caches de trajets
// et de stations) se remplissait, et le lot était alors perdu au rechargement sans partir au serveur.
let items = [];   // [lat, lng, nom, code]
const listeners = [];
export const getIo = () => items;
export const onIoChange = cb => listeners.push(cb);

const idb = () => new Promise((ok, ko) => {
  const req = indexedDB.open('capouest', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => ok(req.result);
  req.onerror = () => ko(req.error);
});
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((ok, ko) => {
    const tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = () => ko(tx.error);
  });
}

// Chargement au démarrage (avec reprise de l'ancien emplacement dans localStorage)
const ready = (async () => {
  try {
    let list = await idbDo('readonly', s => s.get(KEY));
    const old = localStorage.getItem(KEY);
    if (!list && old) {
      list = JSON.parse(old);
      await idbDo('readwrite', s => s.put(list, KEY));
    }
    if (old) localStorage.removeItem(KEY);
    if (Array.isArray(list) && list.length) { items = list; listeners.forEach(cb => cb()); }
  } catch (e) { console.warn('iOverlander : lecture locale impossible', e); }
})();

function store(list, dirty) {
  items = list;
  // Le drapeau « à envoyer » est posé d'abord : même si l'écriture locale échoue, le lot part au serveur
  try { localStorage.setItem(DIRTY_KEY, dirty ? '1' : ''); } catch {}
  idbDo('readwrite', s => s.put(items, KEY)).catch(e => console.warn('iOverlander : écriture locale impossible', e));
  listeners.forEach(cb => cb());
}

// Lecture CSV (guillemets, virgules et retours à la ligne dans les noms)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Test « à moins de km du trajet », rapide : points du tracé tous les ~5 km rangés dans une grille
// de cases de 0,5°, puis comparaison avec les seules cases voisines.
function corridorTest(legs, steps, km) {
  const CELL = 0.5, grid = new Map();
  const add = p => {
    const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
  };
  steps.forEach(s => add([s.lat, s.lng]));
  legs.forEach(l => {
    let acc = 0;
    l.coords.forEach((p, i) => {
      if (i) acc += hav(l.coords[i - 1], p);
      if (i === 0 || acc >= 5) { add(p); acc = 0; }
    });
  });
  const reach = Math.ceil(km / 111 / CELL) + 1;
  return p => {
    const ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lng / CELL);
    for (let di = -reach; di <= reach; di++) {
      for (let dj = -reach * 2; dj <= reach * 2; dj++) {
        const cell = grid.get(`${ci + di},${cj + dj}`);
        if (cell && cell.some(q => hav(q, p) <= km)) return true;
      }
    }
    return false;
  };
}

// Import d'un export CSV : fusionné avec les lieux déjà importés (ex. Canada puis États-Unis).
// legs : tronçons du trajet ({ coords }) ; steps : étapes.
export function importIoCsv(text, legs, steps) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
  const col = name => head.indexOf(name);
  const iLat = col('latitude'), iLng = col('longitude'), iName = col('name'), iCat = col('category');
  if (iLat < 0 || iLng < 0 || iCat < 0) throw new Error('Colonnes Latitude, Longitude et Category introuvables : est-ce bien un export iOverlander ?');

  let read = 0, kept = 0;
  const near = corridorTest(legs, steps, CORRIDOR_KM);

  const seen = new Set(items.map(x => `${x[0]},${x[1]},${x[3]}`));
  const out = items.slice();
  rows.forEach(r => {
    const cat = IO_CATS[r[iCat]?.trim()];
    if (!cat) return;
    read++;
    const lat = +r[iLat], lng = +r[iLng];
    if (!isFinite(lat) || !isFinite(lng) || !near({ lat, lng })) return;
    const x = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, (r[iName] || '').trim().slice(0, 80), cat.k];
    const key = `${x[0]},${x[1]},${x[3]}`;
    if (seen.has(key)) return;
    seen.add(key); out.push(x); kept++;
  });
  store(out, true);
  return { read, kept, total: out.length };
}

export function clearIo() { store([], true); }

// Lieux à moins de « km » d'un point, triés par distance
export function ioNear(p, km, filter = () => true) {
  return items.map(x => ({ x, d: hav(p, { lat: x[0], lng: x[1] }) }))
    .filter(({ x, d }) => d <= km && filter(BY_K[x[3]]))
    .sort((a, b) => a.d - b.d);
}

// Synchronisation privée : tout le lot dans une seule ligne de la table places
export async function syncIo(sb) {
  await ready;   // ne jamais envoyer une liste vide parce que la lecture locale n'est pas finie
  if (localStorage.getItem(DIRTY_KEY) === '1') {
    const { error } = await sb.from('places').upsert({ id: PACK_ID, data: { items }, updated_at: new Date().toISOString() });
    if (error) throw error;
    store(items, false);
    return;
  }
  const { data, error } = await sb.from('places').select('data').eq('id', PACK_ID).maybeSingle();
  if (error) throw error;
  const remote = data?.data?.items;
  if (Array.isArray(remote) && remote.length !== items.length) store(remote, false);
}
