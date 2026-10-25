// Outils géographiques : distances, polylignes encodées, points le long d'un trajet.

const R = 6371, RAD = Math.PI / 180;

// Points en {lat, lng} ou [lat, lng]
const ll = p => Array.isArray(p) ? p : [p.lat, p.lng];

export function hav(a, b) {
  const [lat1, lng1] = ll(a), [lat2, lng2] = ll(b);
  const dLat = (lat2 - lat1) * RAD, dLng = (lng2 - lng1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function lineKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += hav(coords[i - 1], coords[i]);
  return km;
}

// Format « encoded polyline » de Google (OSRM et ORS l'utilisent, précision 5)
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision, out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, byte;
      do { byte = str.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

// Un point tous les `everyKm` km routiers le long des tronçons.
// Chaque tronçon est { coords, km } : la distance géométrique est remise à l'échelle de km
// (utile pour les estimations à vol d'oiseau × 1,2).
export function pointsAlong(legs, everyKm) {
  const pts = [];
  let total = 0, next = everyKm;
  legs.forEach((leg, li) => {
    const geom = lineKm(leg.coords) || 1;
    const scale = leg.km / geom;
    for (let i = 1; i < leg.coords.length; i++) {
      const a = leg.coords[i - 1], b = leg.coords[i];
      const seg = hav(a, b) * scale;
      while (total + seg >= next) {
        const t = (next - total) / seg;
        pts.push({ lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, km: next, leg: li });
        next += everyKm;
      }
      total += seg;
    }
  });
  return pts;
}

export const fmt = n => Math.round(n).toLocaleString('fr-CA');
export const fmtH = h => h == null ? '' : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
