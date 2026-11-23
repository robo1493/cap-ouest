// 🕑🌡️ Heure et météo de l'endroit où l'on est (bande dans l'en-tête) + détails dans 🧰 Outils (#meteoBox).
// Position : GPS si déjà permis (ou au toucher), sinon l'étape prévue aujourd'hui (fonction fallback).
// Météo : Open-Meteo (gratuit, sans clé), fuseau horaire fourni par la même réponse. Vents en km/h.
// Alertes qui CLIGNOTENT (demande de l'utilisateur) : rafales ≥ 50 km/h (maintenant ou d'ici 12 h), gel d'ici 18 h,
// et, pour le prochain jour de route (≤ 2 jours), neige, verglas possible ou vent fort au départ, à mi-chemin ou à l'arrivée.
// Sans Internet : on garde la dernière réponse et on dit quand elle a été prise.

const KEY = 'capOuest.meteo';
const REFRESH = 30 * 60 * 1000;
export const GUST_ALERT = 50; // km/h : un fifth wheel de 55 pi devient difficile à tenir
const ZONES = {
  'America/Toronto': "heure de l'Est", 'America/New_York': "heure de l'Est", 'America/Detroit': "heure de l'Est",
  'America/Indiana/Indianapolis': "heure de l'Est", 'America/Kentucky/Louisville': "heure de l'Est",
  'America/Halifax': "heure de l'Atlantique", 'America/Moncton': "heure de l'Atlantique",
  'America/Chicago': 'heure du Centre', 'America/Winnipeg': 'heure du Centre', 'America/Regina': 'heure de la Saskatchewan',
  'America/Indiana/Knox': 'heure du Centre', 'America/North_Dakota/Center': 'heure du Centre',
  'America/Denver': 'heure des Rocheuses', 'America/Edmonton': 'heure des Rocheuses', 'America/Boise': 'heure des Rocheuses',
  'America/Phoenix': "heure de l'Arizona", 'America/Los_Angeles': 'heure du Pacifique', 'America/Vancouver': 'heure du Pacifique',
};
// Codes météo WMO → pictogramme et mot
const SKY = [[0, '☀️', 'ciel dégagé'], [2, '⛅', 'peu nuageux'], [3, '☁️', 'nuageux'], [48, '🌫️', 'brouillard'], [57, '🌦️', 'bruine'],
  [67, '🌧️', 'pluie'], [77, '🌨️', 'neige'], [82, '🌧️', 'averses'], [86, '🌨️', 'averses de neige'], [99, '⛈️', 'orage']];
const sky = c => SKY.find(([max]) => c <= max) || ['', '❔', ''];
const toF = c => Math.round(c * 9 / 5 + 32);
const toMph = k => Math.round(k / 1.609);
const r0 = Math.round;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayName = d => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

let el, box, fallback, legOf, extra = () => [], data = null, timer = null, busy = false;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ } }

async function gpsAllowed() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch { return false; }
}
function gps() {
  return new Promise((ok, ko) => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, src: 'gps' }), ko,
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 15 * 60 * 1000 })
    : ko(new Error('GPS non disponible')));
}

// Prévision d'un jour de route : départ, mi-chemin (en ligne droite, approx.) et arrivée, en une seule requête
export async function legForecast(leg) {
  const mid = { name: 'mi-chemin (approx.)', lat: (leg.from.lat + leg.to.lat) / 2, lng: (leg.from.lng + leg.to.lng) / 2 };
  const pts = [{ name: leg.from.name, lat: leg.from.lat, lng: leg.from.lng }, mid, { name: leg.to.name, lat: leg.to.lat, lng: leg.to.lng }];
  const day = isoDay(leg.date);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map(p => p.lat.toFixed(3)).join(',')}`
    + `&longitude=${pts.map(p => p.lng.toFixed(3)).join(',')}`
    + '&daily=weather_code,temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,snowfall_sum,precipitation_sum'
    + `&timezone=auto&start_date=${day}&end_date=${day}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('météo ' + r.status);
  let j = await r.json(); if (!Array.isArray(j)) j = [j];
  const spots = pts.map((p, i) => {
    const d = j[i].daily;
    const s = { name: p.name, code: d.weather_code[0], min: d.temperature_2m_min[0], max: d.temperature_2m_max[0],
      gust: d.wind_gusts_10m_max[0], snow: d.snowfall_sum[0], rain: d.precipitation_sum[0] };
    s.alerts = [];
    if (s.snow > 0) s.alerts.push(`🌨️ neige ${s.snow} cm`);
    if (s.min <= 0 && s.rain > 0 && !(s.snow > 0)) s.alerts.push('🧊 verglas possible');
    if (s.gust >= GUST_ALERT) s.alerts.push(`🌬️ rafales ${r0(s.gust)} km/h`);
    return s;
  });
  return { date: day, to: leg.to.name, spots, alerts: spots.flatMap(s => s.alerts.map(a => `${a} (${s.name.split(',')[0]})`)) };
}

async function refresh(askGps = false) {
  if (busy) return; busy = true;
  try {
    let pos = null;
    if (askGps || await gpsAllowed()) { try { pos = await gps(); } catch { pos = null; } }
    if (!pos) { const s = fallback(); if (s) pos = { lat: s.lat, lng: s.lng, src: 'step', name: s.name }; }
    if (!pos) return;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}`
      + '&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,wind_gusts_10m'
      + '&daily=temperature_2m_min,temperature_2m_max&timezone=auto&forecast_days=2';
    const r = await fetch(u);
    if (!r.ok) throw new Error('météo ' + r.status);
    const j = await r.json();
    const now = Date.now();
    // Heures locales ramenées en heure UTC avec le décalage du fuseau
    const hours = j.hourly.time.map((t, i) => ({ t: Date.parse(t + 'Z') - j.utc_offset_seconds * 1000, temp: j.hourly.temperature_2m[i], gust: j.hourly.wind_gusts_10m[i] }))
      .filter(h => h.t >= now - 3600e3);
    const in18 = hours.filter(h => h.t <= now + 18 * 3600e3), in12 = hours.filter(h => h.t <= now + 12 * 3600e3);
    const peak = in12.reduce((a, h) => (!a || h.gust > a.gust ? h : a), null);
    data = {
      at: now, src: pos.src, name: pos.name || '', tz: j.timezone, abbr: j.timezone_abbreviation,
      temp: j.current.temperature_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, gustNow: j.current.wind_gusts_10m,
      min: j.daily.temperature_2m_min[0], max: j.daily.temperature_2m_max[0],
      low18: in18.length ? Math.min(...in18.map(h => h.temp)) : null,
      gust12: peak ? peak.gust : null, gust12At: peak ? peak.t : null, leg: null,
    };
    // Prochain jour de route, s'il est dans la portée des prévisions (16 jours)
    const leg = legOf?.();
    if (leg) {
      const days = Math.round((new Date(leg.date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
      if (days >= 0 && days <= 15) { try { data.leg = { ...(await legForecast(leg)), days }; } catch { /* plus tard */ } }
    }
    save(data);
  } catch { /* hors ligne : on garde la dernière valeur */ } finally { busy = false; render(); }
}

const timeIn = (t, tz) => {
  try { return new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: tz }).replace(':', ' h '); }
  catch { return new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h '); }
};
const windAlert = d => d && Math.max(d.gustNow || 0, d.gust12 || 0) >= GUST_ALERT;
const when = n => n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;

function render() {
  if (!el) return;
  const tz = data?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = data ? (ZONES[data.tz] || data.abbr || data.tz) : '';
  el.textContent = '';
  const add = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; el.append(s); return s; };
  add('mClock', `🕑 ${timeIn(Date.now(), tz)}${zone ? ` (${zone})` : ''}`);
  if (!data) { el.append(' · 🌡️ …'); renderBox(); return; }
  const [, icon] = sky(data.code);
  add('mTemp', ` · ${icon} ${r0(data.temp)} °C (${toF(data.temp)} °F) · min ${r0(data.min)} / max ${r0(data.max)}`);
  if (windAlert(data)) {
    const now = (data.gustNow || 0) >= GUST_ALERT;
    add('mAlert', now ? ` ⚠️ 🌬️ rafales ${r0(data.gustNow)} km/h` : ` ⚠️ 🌬️ rafales ${r0(data.gust12)} km/h vers ${timeIn(data.gust12At, tz)}`);
  }
  if (data.low18 != null && data.low18 <= 0) add('mAlert', ` ⚠️ gel ${r0(data.low18)} °C : tuyaux`);
  const L = data.leg;
  const n = L ? Math.round((new Date(L.date + 'T00:00') - new Date().setHours(0, 0, 0, 0)) / 864e5) : -1;
  if (L && n >= 0 && n <= 2) {
    if (L.alerts.length) add('mAlert', ` ⚠️ 🚐 route ${when(n)} : ${L.alerts[0]}${L.alerts.length > 1 ? ' …' : ''}`);
    else add('mTemp', ` · 🚐 route ${when(n)} : ✔ rien à signaler`);
  }
  for (const a of extra()) add('mAlert', ` ⚠️ ${a}`);
  const age = r0((Date.now() - data.at) / 60000);
  if (age > 90) add('mOld', ` · prise il y a ${age < 1440 ? r0(age / 60) + ' h' : r0(age / 1440) + ' j'}`);
  el.classList.toggle('alert', !!el.querySelector('.mAlert'));
  renderBox();
}

// Détails dans 🧰 Outils
function renderBox() {
  if (!box) return;
  if (!data) { box.innerHTML = '<p class="src">Météo en chargement… (il faut Internet la première fois)</p>'; return; }
  const [, icon, word] = sky(data.code);
  const tz = data.tz;
  const rows = [
    `${icon} ${esc(word)} · <b>${r0(data.temp)} °C</b> (${toF(data.temp)} °F) · aujourd'hui min ${r0(data.min)} °C / max ${r0(data.max)} °C`,
    `🌬️ Vent ${r0(data.wind)} km/h (${toMph(data.wind)} mph), rafales <b>${r0(data.gustNow)} km/h</b> (${toMph(data.gustNow)} mph)`
      + (data.gust12 != null ? ` · plus fortes d'ici 12 h : <b>${r0(data.gust12)} km/h</b> vers ${timeIn(data.gust12At, tz)}` : ''),
    data.low18 != null ? `🌙 Plus bas d'ici 18 h : <b>${r0(data.low18)} °C</b> (${toF(data.low18)} °F)${data.low18 <= 0 ? ' : <b class="warn">gel, protéger les tuyaux et le boyau d’eau</b>' : ''}` : '',
    `📍 ${data.src === 'gps' ? 'Position GPS' : `Étape prévue aujourd'hui : ${esc(data.name)} (touchez « Actualiser avec le GPS » pour votre vraie position)`} · mise à jour à ${timeIn(data.at, tz)}`,
  ].filter(Boolean);
  let h = `<div class="mRows">${rows.map(x => `<div>${x}</div>`).join('')}</div>`;
  if (windAlert(data)) h += `<div class="mBig blink">🌬️ VENT FORT : rafales de ${r0(Math.max(data.gustNow, data.gust12 || 0))} km/h. Avec un fifth wheel de 55 pi : rouler moins vite, attendre si possible, rentrer l’auvent.</div>`;
  const L = data.leg;
  if (L) {
    h += `<h3 style="margin:10px 0 4px">🚐 Prochain jour de route : ${esc(dayName(new Date(L.date + 'T12:00')))} → ${esc(L.to)}</h3>`;
    h += '<table class="tbl"><tr><th>Endroit</th><th>Ciel</th><th>Min / max</th><th>Rafales</th><th>Neige / pluie</th></tr>'
      + L.spots.map(s => `<tr${s.alerts.length ? ' class="warnRow"' : ''}><td>${esc(s.name)}</td><td>${sky(s.code)[1]} ${esc(sky(s.code)[2])}</td>`
        + `<td>${r0(s.min)} / ${r0(s.max)} °C</td><td>${r0(s.gust)} km/h</td><td>${s.snow ? s.snow + ' cm' : '–'} / ${s.rain ? s.rain + ' mm' : '–'}</td></tr>`).join('')
      + '</table>';
    h += L.alerts.length ? `<div class="mBig blink">⚠️ ${L.alerts.map(esc).join(' · ')}</div>` : '<p class="src">✔ Rien à signaler pour ce jour de route.</p>';
    h += '<p class="src">Mi-chemin = point au milieu en ligne droite : pour un col de montagne, vérifier aussi les conditions routières (511 de l’État ou de la province).</p>';
  } else h += '<p class="src">🚐 Prochain jour de route : prévision affichée quand il est à moins de 16 jours.</p>';
  box.innerHTML = h;
}

export function initMeteo(node, stepToday, nextLeg, detailsNode, extraAlerts) {
  el = node; box = detailsNode; fallback = stepToday; legOf = nextLeg; if (extraAlerts) extra = extraAlerts; data = load();
  render();
  refresh();
  setInterval(render, 30 * 1000);
  clearInterval(timer); timer = setInterval(() => refresh(), REFRESH);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!data || Date.now() - data.at > REFRESH)) refresh();
  });
}
export const meteoRefresh = () => refresh(true);
export const meteoRender = () => render();
