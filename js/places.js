// « Mes guides » : lieux relevés dans les guides de voyage personnels de l'utilisateur.
// Ces données ne sont jamais dans le code publié : elles sont importées depuis un fichier
// (Data/mes-lieux.json, hors Git) puis synchronisées de façon privée par Supabase (table places).

import { CATS } from './pois.js';

const KEY = 'capouest.places.v1';
const DIRTY_KEY = 'capouest.places.dirty';

export const PLACE_CATS = {
  ...CATS,
  restaurant: { icon: '🍽', label: 'Restaurants' },
  camping: { icon: '⛺', label: 'Campings' },
};

// Difficulté des sentiers, pensée pour un genou arthrosique
export const DIFF = {
  facile: { label: 'Facile', color: '#2e8b3d' },
  modere: { label: 'Modéré', color: '#d4a106' },
  difficile: { label: 'Difficile · déconseillé pour le genou', color: '#b33' },
};

let places = [];
try { places = JSON.parse(localStorage.getItem(KEY)) || []; } catch { places = []; }
const listeners = [];

export const getPlaces = () => places;
export const onPlacesChange = cb => listeners.push(cb);

function store(list, dirty) {
  places = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(places));
    localStorage.setItem(DIRTY_KEY, dirty ? '1' : '');
  } catch {}
  listeners.forEach(cb => cb());
}

const clean = p => ({
  id: String(p.id), name: String(p.name), cat: PLACE_CATS[p.cat] ? p.cat : 'history',
  lat: +p.lat, lng: +p.lng, diff: DIFF[p.diff] ? p.diff : null,
  note: String(p.note || '').slice(0, 600), src: String(p.src || '').slice(0, 200),
});

// Importe un fichier mes-lieux.json ; remplace la liste (les lieux de même id sont mis à jour)
export function importPlaces(text) {
  const data = JSON.parse(text);
  const list = (data.places || data).filter(p => p && p.id && p.name && isFinite(p.lat) && isFinite(p.lng)).map(clean);
  if (!list.length) throw new Error('Aucun lieu valide dans ce fichier.');
  store(list, true);
  return list.length;
}

// Synchronisation privée (appelée par sync.js une fois connecté)
// - après un import sur cet appareil : on envoie la liste et on retire du serveur les lieux disparus
// - sinon : on reçoit la liste du serveur
export async function syncPlaces(sb) {
  const dirty = localStorage.getItem(DIRTY_KEY) === '1';
  if (dirty) {
    const rows = places.map(p => ({ id: p.id, data: p, updated_at: new Date().toISOString() }));
    let { error } = await sb.from('places').upsert(rows);
    if (error) throw error;
    ({ error } = await sb.from('places').delete().not('id', 'in', `(${rows.map(r => `"${r.id}"`).join(',')})`));
    if (error) throw error;
    store(places, false);
    return;
  }
  const { data, error } = await sb.from('places').select('data');
  if (error) throw error;
  const list = data.map(r => clean(r.data));
  if (JSON.stringify(list.map(p => p.id).sort()) !== JSON.stringify(places.map(p => p.id).sort())
    || JSON.stringify(list) !== JSON.stringify(places)) {
    store(list, false);
  }
}
