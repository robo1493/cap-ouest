// Journal des pleins réels : odomètre, litres, prix, lieu. Sert à calculer la consommation réelle
// (entre deux pleins complets), le prix moyen payé et le budget diesel réel.
// Gardé sur l'appareil (localStorage, petit) et synchronisé en privé dans la table places (id FUEL_ID).
// Fusion entre appareils : chaque plein a un id ; la version la plus récente (champ u) l'emporte,
// et une suppression est gardée comme pierre tombale (del) pour se propager.

const KEY = 'capouest.fuel.v1';
export const FUEL_ID = '__fuel__';

let all = [];
try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch { all = []; }
const listeners = [];
export const onFuelChange = cb => listeners.push(cb);

function store(list) {
  all = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  listeners.forEach(cb => cb());
}

const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

// Pleins visibles, du plus ancien au plus récent (odomètre, puis date)
export const getFills = () => all.filter(f => !f.del).sort((a, b) => a.odo - b.odo || a.at.localeCompare(b.at));

export function addFill(f) {
  store([...all, { id: uid(), u: Date.now(), ...f }]);
}

export function delFill(id) {
  store(all.map(f => f.id === id ? { id, del: true, u: Date.now() } : f));
}

// Statistiques : consommation par intervalle entre deux pleins complets
export function fuelStats() {
  const fills = getFills();
  const spans = new Map();      // id du plein complet qui ferme l'intervalle → L/100 km
  let km = 0, litres = 0, lastFull = null, between = 0;
  fills.forEach(f => {
    if (lastFull) between += f.litres;
    if (f.full) {
      if (lastFull && f.odo > lastFull.odo) {
        const d = f.odo - lastFull.odo;
        spans.set(f.id, between / d * 100);
        km += d; litres += between;
      }
      lastFull = f; between = 0;
    }
  });
  const totalL = fills.reduce((t, f) => t + f.litres, 0);
  const totalCost = fills.reduce((t, f) => t + f.cost, 0);
  return {
    fills, spans,
    lPer100: km >= 100 ? litres / km * 100 : 0,       // au moins 100 km mesurés pour être fiable
    measuredKm: km,
    totalL, totalCost,
    priceL: totalL ? totalCost / totalL : 0,
    lastFull: [...fills].reverse().find(f => f.full) || null,
  };
}

// Synchronisation : fusion par id (la modification la plus récente l'emporte)
export async function syncFuel(sb) {
  const { data, error } = await sb.from('places').select('data').eq('id', FUEL_ID).maybeSingle();
  if (error) throw error;
  const remote = Array.isArray(data?.data?.fills) ? data.data.fills : [];
  const byId = new Map(remote.map(f => [f.id, f]));
  all.forEach(f => { const r = byId.get(f.id); if (!r || f.u > r.u) byId.set(f.id, f); });
  const merged = [...byId.values()];
  const same = (a, b) => JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)));
  if (!same(merged, remote)) {
    const { error: e2 } = await sb.from('places').upsert({ id: FUEL_ID, data: { fills: merged }, updated_at: new Date().toISOString() });
    if (e2) throw e2;
  }
  if (!same(merged, all)) store(merged);
}
