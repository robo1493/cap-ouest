// Accès commun à OpenStreetMap via l'API Overpass (sans clé), partagé par stations.js et pois.js.
// Le serveur public refuse les requêtes simultanées (429) : toutes passent par une seule file d'attente.

import { hav } from './geo.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

let queue = Promise.resolve();

// Exécute une requête Overpass QL, une à la fois. Le serveur met souvent ~40 s à répondre.
export function overpass(query) {
  const run = queue.then(() => send(query));
  queue = run.catch(() => {});
  return run;
}

async function send(query) {
  let last;
  // Serveur occupé (429, 502, 504) : on attend un peu et on réessaie, puis on passe au miroir
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(200000) });
        if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
        return (await r.json()).elements;
      } catch (e) { last = e; }
    }
    await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
  }
  throw last;
}

// Le trajet découpé en boîtes (~boxKm de route chacune), élargies de padKm.
// Une requête par boîtes est bien plus rapide pour le serveur qu'une recherche « autour d'une ligne ».
export function boxes(coords, padKm, boxKm) {
  const out = [], pad = padKm / 111 + 0.005;
  let box = null, acc = 0;
  coords.forEach((p, i) => {
    if (!box) box = [p[0], p[1], p[0], p[1]];
    box = [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])];
    if (i) acc += hav(coords[i - 1], p);
    if (acc >= boxKm || i === coords.length - 1) {
      const padLng = pad / Math.cos(p[0] * Math.PI / 180);
      out.push([box[0] - pad, box[1] - padLng, box[2] + pad, box[3] + padLng].map(v => v.toFixed(4)).join(','));
      box = [p[0], p[1], p[0], p[1]]; acc = 0;
    }
  });
  return out;
}

// Distance au trajet et position (km depuis le début du tronçon), par projection sur chaque segment
export function project(p, coords) {
  const kx = Math.cos(p.lat * Math.PI / 180) * 111.32, ky = 110.57;
  let best = Infinity, bestAlong = 0, along = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const ax = (a[1] - p.lng) * kx, ay = (a[0] - p.lat) * ky;
    const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
    const l2 = dx * dx + dy * dy, seg = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy, d = x * x + y * y;
    if (d < best) { best = d; bestAlong = along + t * seg; }
    along += seg;
  }
  return { off: Math.sqrt(best), along: bestAlong, total: along };
}
