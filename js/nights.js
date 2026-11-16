// 🌙 Carnet des nuits : ce qui s'est vraiment passé chaque nuit (où l'on a dormi, prix, services,
// étoiles, « ma journée »). Une entrée par date (id = AAAA-MM-JJ), gardée sur l'appareil (localStorage)
// et synchronisée en privé dans la table places (id NIGHTS_ID), fusion par id comme les favoris :
// la version la plus récente gagne, suppression = pierre tombale.
//
// Entrée : { id, u, as (comme prévu), name, lat, lng, reg ('US' ou code de province), kind ('c' camping,
// 'b' boondock, 'w' Walmart / relais, 'h' chez quelqu'un), paid, cur ('CAD' | 'USD'), cad (montant en $ CA),
// svc (liste : e30 e50 w s d cell wifi), stars (0 à 5), verdict ('back' | 'avoid' | ''), day (texte), odo }

const KEY = 'capouest.nights.v1';
export const NIGHTS_ID = '__nights__';

export const NIGHT_KINDS = {
  c: { icon: '🏕', label: 'Camping' },
  b: { icon: '🌵', label: 'Boondock' },
  w: { icon: '🛒', label: 'Walmart / relais' },
  h: { icon: '🏠', label: 'Chez quelqu’un' },
};
export const NIGHT_SVC = {
  e30: '🔌 30 A', e50: '🔌 50 A', w: '🚰 Eau', s: '🚽 Égout', d: '🕳 Vidange', cell: '📶 Cell', wifi: '🛜 Wifi',
};

let all = [];
try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch { all = []; }
const listeners = [];
export const onNightsChange = cb => listeners.push(cb);

function store(list) {
  all = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  listeners.forEach(cb => cb());
}

export const getNights = () => all.filter(n => !n.del);
export const getNight = id => all.find(n => n.id === id && !n.del) || null;

export function setNight(id, changes) {
  const old = getNight(id);
  const n = { ...(old || {}), ...changes, id, u: Date.now() };
  delete n.del;
  store([...all.filter(x => x.id !== id), n]);
  return n;
}

export function delNight(id) {
  store([...all.filter(x => x.id !== id), { id, del: true, u: Date.now() }]);
}

// Synchronisation : fusion par id (la modification la plus récente l'emporte)
export async function syncNights(sb) {
  const { data, error } = await sb.from('places').select('data').eq('id', NIGHTS_ID).maybeSingle();
  if (error) throw error;
  const remote = Array.isArray(data?.data?.nights) ? data.data.nights : [];
  const byId = new Map(remote.map(n => [n.id, n]));
  all.forEach(n => { const r = byId.get(n.id); if (!r || n.u > r.u) byId.set(n.id, n); });
  const merged = [...byId.values()];
  const same = (a, b) => JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)));
  if (!same(merged, remote)) {
    const { error: e2 } = await sb.from('places').upsert({ id: NIGHTS_ID, data: { nights: merged }, updated_at: new Date().toISOString() });
    if (e2) throw e2;
  }
  if (!same(merged, all)) store(merged);
}
