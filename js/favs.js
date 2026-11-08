// ⭐ Mes campings favoris : endroits choisis par l'utilisateur (depuis la fiche d'un camping, d'un lieu
// iOverlander, un formulaire ou un lien #fav=…), toujours visibles sur la carte, peu importe le zoom.
// Gardés sur l'appareil (localStorage) et synchronisés en privé dans la table places (id FAV_ID),
// fusion par id comme le journal des pleins : la version la plus récente gagne, suppression = pierre tombale.

const KEY = 'capouest.favs.v1';
export const FAV_ID = '__favs__';

let all = [];
try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch { all = []; }
const listeners = [];
export const onFavsChange = cb => listeners.push(cb);

function store(list) {
  all = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  listeners.forEach(cb => cb());
}

const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

export const getFavs = () => all.filter(f => !f.del);

// Même endroit (à ~100 m près) : on ne l'ajoute pas deux fois
export const favAt = (lat, lng) => getFavs().find(f => Math.abs(f.lat - lat) < 0.001 && Math.abs(f.lng - lng) < 0.001);

export function addFav({ name, lat, lng, note = '', web = '', tel = '' }) {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const old = favAt(lat, lng);
  if (old) return old;
  const f = { id: uid(), u: Date.now(), name: String(name || 'Camping').slice(0, 120), lat: +lat, lng: +lng,
    note: String(note).slice(0, 600), web: String(web).slice(0, 200), tel: String(tel).slice(0, 30) };
  store([...all, f]);
  return f;
}

export function editFav(id, changes) {
  store(all.map(f => f.id === id ? { ...f, ...changes, u: Date.now() } : f));
}

export function delFav(id) {
  store(all.map(f => f.id === id ? { id, del: true, u: Date.now() } : f));
}

// Synchronisation : fusion par id (la modification la plus récente l'emporte)
export async function syncFavs(sb) {
  const { data, error } = await sb.from('places').select('data').eq('id', FAV_ID).maybeSingle();
  if (error) throw error;
  const remote = Array.isArray(data?.data?.favs) ? data.data.favs : [];
  const byId = new Map(remote.map(f => [f.id, f]));
  all.forEach(f => { const r = byId.get(f.id); if (!r || f.u > r.u) byId.set(f.id, f); });
  const merged = [...byId.values()];
  const same = (a, b) => JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)));
  if (!same(merged, remote)) {
    const { error: e2 } = await sb.from('places').upsert({ id: FAV_ID, data: { favs: merged }, updated_at: new Date().toISOString() });
    if (e2) throw e2;
  }
  if (!same(merged, all)) store(merged);
}
