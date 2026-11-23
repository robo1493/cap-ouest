// 🕑🌡️ Heure et température de l'endroit où l'on est (bande dans l'en-tête).
// Position : GPS si déjà permis, sinon l'étape prévue aujourd'hui (fonction fallback).
// Météo : Open-Meteo (gratuit, sans clé), fuseau horaire fourni par la même réponse.
// Sans Internet : on garde la dernière réponse et on dit quand elle a été prise.

const KEY = 'capOuest.meteo';
const REFRESH = 30 * 60 * 1000;
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

let el, fallback, data = null, timer = null, busy = false;

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

async function refresh(askGps = false) {
  if (busy) return; busy = true;
  try {
    let pos = null;
    if (askGps || await gpsAllowed()) { try { pos = await gps(); } catch { pos = null; } }
    if (!pos) { const s = fallback(); if (s) pos = { lat: s.lat, lng: s.lng, src: 'step', name: s.name }; }
    if (!pos) return;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}`
      + '&current=temperature_2m,weather_code&hourly=temperature_2m&daily=temperature_2m_min,temperature_2m_max'
      + '&timezone=auto&forecast_days=2';
    const r = await fetch(u);
    if (!r.ok) throw new Error('météo ' + r.status);
    const j = await r.json();
    const now = Date.now(), until = now + 18 * 3600e3;
    // Températures des 18 prochaines heures (les heures sont en heure locale : on les ramène en UTC avec le décalage)
    const next = j.hourly.time.map((t, i) => [Date.parse(t + 'Z') - j.utc_offset_seconds * 1000, j.hourly.temperature_2m[i]])
      .filter(([t]) => t >= now - 3600e3 && t <= until).map(([, v]) => v);
    data = {
      at: now, src: pos.src, name: pos.name || '', tz: j.timezone, abbr: j.timezone_abbreviation,
      temp: j.current.temperature_2m, code: j.current.weather_code,
      min: j.daily.temperature_2m_min[0], max: j.daily.temperature_2m_max[0],
      low18: next.length ? Math.min(...next) : null,
    };
    save(data);
  } catch { /* hors ligne : on garde la dernière valeur */ } finally { busy = false; render(); }
}

function render() {
  if (!el) return;
  const tz = data?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let time;
  try { time = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: tz }); }
  catch { time = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); }
  const zone = data ? (ZONES[data.tz] || data.abbr || data.tz) : '';
  el.textContent = '';
  const t = document.createElement('span'); t.className = 'mClock';
  t.textContent = `🕑 ${time.replace(':', ' h ')}${zone ? ` (${zone})` : ''}`;
  el.append(t);
  if (!data) { el.append(' · 🌡️ …'); el.title = 'Météo en chargement'; return; }
  const [, icon, word] = sky(data.code);
  const w = document.createElement('span'); w.className = 'mTemp';
  w.textContent = ` · ${icon} ${Math.round(data.temp)} °C (${toF(data.temp)} °F) · min ${Math.round(data.min)} / max ${Math.round(data.max)}`;
  el.append(w);
  if (data.low18 != null && data.low18 <= 0) {
    const g = document.createElement('span'); g.className = 'mFrost';
    g.textContent = ` · ⚠️ gel prévu (${Math.round(data.low18)} °C) : protéger les tuyaux`;
    el.append(g);
  }
  const age = Math.round((Date.now() - data.at) / 60000);
  if (age > 90) { const o = document.createElement('span'); o.className = 'mOld'; o.textContent = ` · prise il y a ${age < 1440 ? Math.round(age / 60) + ' h' : Math.round(age / 1440) + ' j'}`; el.append(o); }
  el.title = `${word}${data.src === 'gps' ? ' · position GPS' : ` · étape prévue : ${data.name}`} · touchez pour actualiser avec le GPS`
    + (data.low18 != null ? ` · plus bas d'ici 18 h : ${Math.round(data.low18)} °C (${toF(data.low18)} °F)` : '');
}

export function initMeteo(node, stepToday) {
  el = node; fallback = stepToday; data = load();
  render();
  el.onclick = () => { el.classList.add('mBusy'); refresh(true).finally(() => el.classList.remove('mBusy')); };
  refresh();
  setInterval(render, 30 * 1000);
  clearInterval(timer); timer = setInterval(() => refresh(), REFRESH);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!data || Date.now() - data.at > REFRESH)) refresh();
  });
}
