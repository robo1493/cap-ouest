// Stockage local des caches (trajets, stations, découvertes, passages bas, histoire) dans IndexedDB
// (base « capouest », magasin « kv », comme iOverlander et le chemin parcouru).
// localStorage (~5 Mo) était trop petit pour tout le voyage : une écriture refusée faisait perdre des données.

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

// Charge un cache (objet) ; la première fois, reprend l'ancienne copie de localStorage et la retire
export async function loadCache(key) {
  try {
    let v = await idbDo('readonly', s => s.get(key));
    const old = localStorage.getItem(key);
    if (v == null && old) {
      try { v = JSON.parse(old); } catch { v = null; }
      if (v) await idbDo('readwrite', s => s.put(v, key));
    }
    if (old) localStorage.removeItem(key);
    return v || {};
  } catch (e) {
    console.warn('Cache local illisible', key, e);
    return {};
  }
}

// Enregistrement regroupé (une écriture au plus toutes les 2 s par cache)
const timers = {};
export function saveCache(key, obj) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    idbDo('readwrite', s => s.put(obj, key)).catch(e => console.warn('Cache local non enregistré', key, e));
  }, 2000);
}
