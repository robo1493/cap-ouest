// Hauteur du soleil (degrés au-dessus de l'horizon) à une date et un lieu : formules simplifiées
// de l'almanach nautique, précises à ~1°, assez pour passer la carte en mode nuit au coucher du soleil.
export function sunAltitude(date, lat, lng) {
  const r = Math.PI / 180;
  const d = (date - 946728000000) / 864e5;                         // jours depuis le 1er janvier 2000, 12 h UTC
  const g = (357.529 + 0.98560028 * d) * r;                        // anomalie moyenne
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r;   // longitude écliptique
  const e = (23.439 - 0.00000036 * d) * r;                         // obliquité
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * r;
  const H = gmst + lng * r - ra;                                   // angle horaire
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(H)) / r;
}

// Nuit : soleil à plus de 3° sous l'horizon (un peu après le coucher, un peu avant le lever)
export const isNight = (date, lat, lng) => sunAltitude(date, lat, lng) < -3;
