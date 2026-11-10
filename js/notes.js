// 📒 Carnet : notes et rappels de l'utilisateur (infos trouvées, choses à faire, échéances).
// Une note : { id, u, title, text, date ('AAAA-MM-JJ' ou ''), step (id d'étape ou ''), done }.
// Les éléments automatiques du calendrier (ouverture des réservations) gardent leur état « fait »
// dans une entrée { id: 'done:<clé>', flag: true, done }.
// Gardé sur l'appareil (localStorage) et synchronisé en privé dans la table places (id NOTES_ID),
// fusion par id comme les favoris : la modification la plus récente gagne, suppression = pierre tombale.

const KEY = 'capouest.notes.v1';
export const NOTES_ID = '__notes__';

let all = [];
try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch { all = []; }
const listeners = [];
export const onNotesChange = cb => listeners.push(cb);

function store(list) {
  all = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  listeners.forEach(cb => cb());
}
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
const clean = n => ({
  title: String(n.title || '').slice(0, 160), text: String(n.text || '').slice(0, 4000),
  date: /^\d{4}-\d{2}-\d{2}$/.test(n.date || '') ? n.date : '', step: String(n.step || ''), done: !!n.done,
});

export const getNotes = () => all.filter(n => !n.del && !n.flag);
export const getNote = id => getNotes().find(n => n.id === id);

export function addNote(n) {
  const note = { id: uid(), u: Date.now(), ...clean(n) };
  if (!note.title && !note.text) return null;
  // Même note déjà ajoutée (lien ouvert deux fois) : on ne la double pas
  const same = getNotes().find(o => o.title === note.title && o.text === note.text && o.date === note.date);
  if (same) return same;
  store([...all, note]);
  return note;
}
export function editNote(id, changes) {
  store(all.map(n => n.id === id ? { ...n, ...clean({ ...n, ...changes }), u: Date.now() } : n));
}
export function delNote(id) {
  store(all.map(n => n.id === id ? { id, del: true, u: Date.now() } : n));
}

// État « fait » des éléments automatiques
export const isDone = key => !!all.find(n => n.id === 'done:' + key && n.done);
export function setDone(key, done) {
  const id = 'done:' + key;
  store([...all.filter(n => n.id !== id), { id, flag: true, done: !!done, u: Date.now() }]);
}

export async function syncNotes(sb) {
  const { data, error } = await sb.from('places').select('data').eq('id', NOTES_ID).maybeSingle();
  if (error) throw error;
  const remote = Array.isArray(data?.data?.notes) ? data.data.notes : [];
  const byId = new Map(remote.map(n => [n.id, n]));
  all.forEach(n => { const r = byId.get(n.id); if (!r || n.u > r.u) byId.set(n.id, n); });
  const merged = [...byId.values()];
  const key = l => JSON.stringify([...l].sort((x, y) => x.id.localeCompare(y.id)));
  if (key(merged) !== key(remote)) {
    const { error: e2 } = await sb.from('places').upsert({ id: NOTES_ID, data: { notes: merged }, updated_at: new Date().toISOString() });
    if (e2) throw e2;
  }
  if (key(merged) !== key(all)) store(merged);
}
