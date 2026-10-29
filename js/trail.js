// Chemin réellement parcouru (positions GPS du mode conduite), gardé sur cet appareil dans IndexedDB
// (base « capouest », magasin « kv », clé « trail »). Par jour : des segments de points [lat, lng].
// Un point est ajouté tous les 50 m environ ; un saut de plus de 5 km (appli fermée en roulant,
// GPS revenu après un tunnel) commence un nouveau segment sans compter la ligne droite.

import { hav } from './geo.js';

const KEY = 'trail';
const STEP_KM = 0.05, JUMP_KM = 5, MAX_ACC_M = 50;

let days = {};                 // 'AAAA-MM-JJ' → [[ [lat, lng], … ], …]
const listeners = [];
export const onTrailChange = cb => listeners.push(cb);
const changed = () => listeners.forEach(cb => cb());

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

const ready = idbDo('readonly', s => s.get(KEY))
  .then(v => { days = v || {}; changed(); })
  .catch(e => console.warn('Trace', e));

// Enregistrement regroupé (au plus toutes les 15 s), et tout de suite quand on quitte l'appli
let dirty = false, timer = null;
const save = () => { timer = null; if (!dirty) return; dirty = false; idbDo('readwrite', s => s.put(days, KEY)).catch(e => console.warn('Trace', e)); };
const later = () => { dirty = true; if (!timer) timer = setTimeout(save, 15000); };
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
addEventListener('pagehide', save);

const today = () => new Date().toLocaleDateString('fr-CA');   // AAAA-MM-JJ, heure locale

let last = null;   // dernier point gardé
export async function addPoint(lat, lng, accuracyM) {
  await ready;
  if (accuracyM > MAX_ACC_M) return;
  const p = [+lat.toFixed(5), +lng.toFixed(5)], d = today();
  const segs = days[d] || (days[d] = []);
  const d0 = last ? hav(last, p) : Infinity;
  if (d0 < STEP_KM) return;
  if (!segs.length || d0 > JUMP_KM || last.day !== d) segs.push([p]);
  else segs[segs.length - 1].push(p);
  last = Object.assign([...p], { day: d });
  later();
  changed();
}

const segKm = seg => seg.reduce((t, p, i) => i ? t + hav(seg[i - 1], p) : 0, 0);
const dayKm = d => (days[d] || []).reduce((t, s) => t + segKm(s), 0);

export const trailKm = () => ({ today: dayKm(today()), total: Object.keys(days).reduce((t, d) => t + dayKm(d), 0) });
export const trailSegments = () => Object.values(days).flat().filter(s => s.length > 1);

export async function clearTrail() {
  await ready;
  days = {}; last = null; dirty = true; save();
  changed();
}
