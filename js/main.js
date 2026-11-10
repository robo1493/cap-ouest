/* global L */
import { YELLOWSTONE_BY, PHASE2, FUEL, TYPE_LABEL, DEFAULT_VEHICLE } from './data.js';
import { trip, settings, saveTrip, saveSettings, resetTrip, newStep, exportTrip, importTrip } from './store.js';
import { cachedOrEstimate, fetchMissing, routeOnce, providerOf, testOrs, clearRouteCache, PROVIDER_LABEL } from './routing.js';
import { hav, pointsAlong, lineKm, fmt, fmtH } from './geo.js';
import { LEVEL, stationsAlong, fetchMissingStations, stationProgress, clearStationCache } from './stations.js';
import { initSync, onStatus, onRemoteChange, signIn, verifyCode, signInPassword, setPassword, signOut, syncNow } from './sync.js';
import { CATS, poisAlong, fetchMissingPois, poiProgress, clearPoiCache, wikiLink, stopRadiusKm, leaveRigAt } from './pois.js';
import { cityHistory } from './history.js';
import { PLACE_CATS, DIFF, getPlaces, onPlacesChange, importPlaces } from './places.js';
import { project } from './overpass.js';
import { dayLog, usPeriods, usRollingMax, latestUsExit, qcAbsence, US_LIMIT, QC_LIMIT } from './days.js';
import { proposals, simulate } from './catchup.js';
import { BY_K, GROUPS, getIo, onIoChange, importIoCsv, clearIo, ioNear, ioBigCount } from './ioverlander.js';
import { CHAINS, loadChains, chainsNear } from './chains.js';
import { CAMP_KINDS, CAMP_FLAGS, loadCamps, campsNear } from './camps.js';
import { loadCoe, coeNear, coeAll } from './coe.js';
import { RESV_EQUIP, RESV_AMPS, resvSites, resvText } from './resv.js';
import { clearancesAlong, fetchMissingClearances, clearanceProgress, clearClearanceCache, feet } from './clearances.js';
import { addPoint, trailKm, trailSegments, onTrailChange, clearTrail } from './trail.js';
import { isNight as sunDown } from './night.js';
import { getFills, addFill, delFill, fuelStats, onFuelChange } from './fuel.js';
import { getFavs, addFav, editFav, delFav, favAt, onFavsChange } from './favs.js';
import { ready as routesReady } from './routing.js';
import { ready as stationsReady } from './stations.js';
import { ready as poisReady } from './pois.js';
import { ready as clearancesReady } from './clearances.js';
import { ready as historyReady } from './history.js';

// Les caches (trajets, stations, découvertes, passages bas, histoire) sont dans IndexedDB : les charger d'abord
await Promise.all([routesReady, stationsReady, poisReady, clearancesReady, historyReady]);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNight = s => s.type === 'b' || s.type === 'c';

// ---------- Dates : départ + somme des nuits des étapes précédentes ----------
const parseIso = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const dayDiff = (a, b) => Math.round((b - a) / 864e5);
const arrival = i => addDays(parseIso(trip.startIso), trip.steps.slice(0, i).reduce((t, s) => t + s.nights, 0));
const shortDate = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

const routeOpts = () => ({ orsKey: settings.orsKey, vehicle: settings.vehicle });

// Consommation et prix : réels (journal des pleins) si l'option est cochée et qu'il y a assez de mesures,
// sinon la valeur saisie dans Carburant ; distance avant le seuil de plein (50 % du réservoir)
let fstats = fuelStats();
const useReal = () => settings.fuelAuto !== false;
const lPer100 = () => useReal() && fstats.lPer100 ? Math.round(fstats.lPer100 * 10) / 10 : settings.lPer100 || FUEL.lPer100;
const priceL = () => useReal() && fstats.priceL ? fstats.priceL : FUEL.priceCad;
// Distance maximale par jour (réglable) ; un tronçon peut être accepté plus long (route facile)
const maxKm = () => settings.maxKmDay || 400;
const tooLong = (leg, s) => leg.provider !== 'ferry' && leg.km > maxKm() && !s.extra?.longOk;
const fuelKm = () => FUEL.tankL * FUEL.threshold / (lPer100() / 100);

// ---------- Carte ----------
// rotate : extension leaflet-rotate (carte orientée « route devant » en mode conduite), sans gestes de rotation
const map = L.map('map', { zoomControl: false, worldCopyJump: true, zoomSnap: 0.25, rotate: true, rotateControl: false, touchRotate: false, shiftKeyRotate: false });
// Les icônes grossissent avec le zoom de la carte (×1 à zoom 6, jusqu'à ×2,2 de près)
const scaleIcons = () => map.getContainer().style.setProperty('--k', Math.min(2.2, Math.max(1, 1 + (map.getZoom() - 6) * 0.2)).toFixed(2));
map.on('zoom zoomend', scaleIcons);
// OSM et CARTO refusent les tuiles sans « Referer » (fichier ouvert en local) : on passe par Esri
const baseMaps = {
  plan: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
};
baseMaps[settings.baseMap] ? baseMaps[settings.baseMap].addTo(map) : baseMaps.plan.addTo(map);

// Terres publiques des États-Unis (service public du Bureau of Land Management) : où le camping
// libre (« dispersed camping ») est généralement permis. Tuiles disponibles jusqu'au zoom 14.
const publicLands = L.tileLayer('https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}',
  { maxNativeZoom: 14, maxZoom: 19, opacity: 0.55, attribution: '© BLM' });

const layers = {
  lines: L.layerGroup().addTo(map),
  stations: L.layerGroup().addTo(map),
  pois: L.layerGroup().addTo(map),
  guides: L.layerGroup().addTo(map),
  fuel: L.layerGroup().addTo(map),
  ends: L.layerGroup().addTo(map),
  b: L.layerGroup().addTo(map),
  c: L.layerGroup().addTo(map),
  preview: L.layerGroup().addTo(map),
  detour: L.layerGroup().addTo(map),
  clear: L.layerGroup().addTo(map),
  trail: L.layerGroup().addTo(map),
};
const markers = new Map();   // id d'étape → marqueur Leaflet
let legs = [];               // legs[i] : tronçon de steps[i] à steps[i+1]
let fuelPts = [];
let stations = [];
let pois = [];
let clearances = [];

function markerIcon(s, n) {
  const cls = s.type === 'dest' ? 'mk dest' : 'mk ' + s.type;
  const label = s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n;
  const size = s.type === 'dest' ? 32 : 26;
  return L.divIcon({ className: '', html: `<div class="${cls}">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

// Itinéraire dans Google Maps (application si installée) : vers l'adresse saisie, sinon vers le point de l'étape
const goUrl = s => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.extra?.addr?.trim() || `${s.lat},${s.lng}`);

// Position GPS saisie à la main : « 48.4284, -123.3656 », « 48.4284 N 123.3656 O »,
// degrés-minutes-secondes « 48°25'42"N 123°21'56"W » ou lien Google Maps (…@48.42,-123.36…)
const gpsText = s => `${(+s.lat).toFixed(5)}, ${(+s.lng).toFixed(5)}`;
function parseGps(str) {
  const t = String(str || '').trim();
  const at = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|destination|ll)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  let lat, lng;
  if (at) { lat = +at[1]; lng = +at[2]; }
  else {
    // Chaque coordonnée : nombre signé, puis minutes / secondes facultatives, puis lettre N S E W O facultative
    const re = /([-+]?\d+(?:[.,]\d+)?)\s*°?\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″]|''))?\s*([NSEWO])?/gi;
    const parts = [...t.matchAll(re)].filter(m => m[0].trim());
    if (parts.length < 2) return null;
    const val = m => {
      const num = x => x ? +x.replace(',', '.') : 0;
      let v = Math.abs(num(m[1])) + num(m[2]) / 60 + num(m[3]) / 3600;
      if (m[1].startsWith('-') || /[SWO]/i.test(m[4] || '')) v = -v;
      return v;
    };
    lat = val(parts[0]); lng = val(parts[1]);
    // « 123.36 O, 48.42 N » : longitude écrite en premier
    if (/[EWO]/i.test(parts[0][4] || '') && /[NS]/i.test(parts[1][4] || '')) [lat, lng] = [lng, lat];
  }
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
const GPS_HELP = 'Exemples : 48.4284, -123.3656 · 48°25\'42"N 123°21\'56"W · lien Google Maps';

// Choix de rechange d'une étape (extra.alts) : autres campings ou boondocks si l'endroit prévu est
// complet ou ne convient pas au rig. { name, lat?, lng?, addr?, note? }
const altGo = a => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(a.addr || (a.lat != null ? `${a.lat},${a.lng}` : a.name));
function altsHtml(s, i) {
  const alts = s.extra?.alts || [];
  return `<details class="alts"${alts.length ? ' open' : ''}><summary>🔁 Choix de rechange${alts.length ? ` (${alts.length})` : ''}</summary>
    ${alts.map((a, k) => `<div class="alt"><b>${k + 1}.</b><div>${esc(a.name)}
      <small>${a.lat != null ? `${fmt(hav(s, a))} km de l’étape` : ''}${a.addr ? ` · ${esc(a.addr)}` : ''}${a.note ? ` · ${esc(a.note)}` : ''}</small></div>
      <a class="btn sm" href="${altGo(a)}" target="_blank" rel="noopener" title="Itinéraire dans Google Maps">🧭</a>
      <button class="btn sm" onclick="act('altUse', ${i}, ${k})" title="En faire l’endroit prévu (l’actuel passe en rechange)">⇄</button>
      <button class="btn sm" onclick="if (confirm('Retirer ce choix de rechange ?')) act('altDel', ${i}, ${k})" title="Retirer">✕</button></div>`).join('')}
    <div class="alt-add"><input id="altName" placeholder="Nom (camping, BLM…)">
      <input id="altWhere" placeholder="GPS ou adresse (facultatif)" title="${esc(GPS_HELP)}">
      <button class="btn sm" onclick="act('altAdd', ${i}, [document.getElementById('altName').value, document.getElementById('altWhere').value])">Ajouter</button></div>
  </details>`;
}

// « Placer après » : déplacer l'étape n'importe où dans le voyage (une nouvelle étape près de Montréal
// peut tomber sur le retour de mars plutôt qu'au départ de juin)
function placeAfterHtml(i) {
  const steps = trip.steps, last = steps.length - 1;
  const opts = steps.map((x, j) => j === i || j === last ? ''
    : `<option value="${j}"${j === i - 1 ? ' selected' : ''}>${j ? j + '. ' : '⌂ '}${esc(x.name.split(',')[0])} (${arrival(j).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })})</option>`).join('');
  return `<label class="after">Placer après <select onchange="act('moveAfter', ${i}, +this.value)">${opts}</select></label>`;
}

function popupHtml(i) {
  const s = trip.steps[i], prev = trip.steps[i - 1], leg = legs[i - 1];
  const km = !prev || !leg ? 'Point de départ'
    : leg.provider === 'ferry' ? `⛴ Traversier depuis ${esc(prev.name.split(',')[0])}`
    : `${fmt(leg.km)} km${leg.h ? ' · ' + fmtH(leg.h) : ''} depuis ${esc(prev.name.split(',')[0])}`;
  const canType = isNight(s);
  return `<div class="pop">
    <span class="chip ${s.type}">${TYPE_LABEL[s.type]}</span>
    <input value="${esc(s.name)}" onchange="act('rename', ${i}, this.value)">
    <div>${km}</div>
    ${milestoneHtml(i)}${s.extra?.note ? `<div class="src">ℹ ${esc(s.extra.note)}</div>` : ''}${s.type !== 'start' ? ioSummary(s) : ''}
    ${leg && leg.provider !== 'ferry' && leg.km > maxKm() ? `<label style="display:block"><input type="checkbox" ${s.extra?.longOk ? 'checked' : ''} onchange="act('longOk', ${i}, this.checked)">
      Tronçon long accepté (${fmt(leg.km)} km, route facile)</label>` : ''}
    <div>${s.type === 'start' ? 'Départ' : 'Arrivée'} : <input type="date" style="width:auto" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)"></div>
    ${canType ? placeAfterHtml(i) : ''}
    ${canType ? `<div>Nuits ici : <b>${s.nights}</b>
      <button class="btn sm" onclick="act('nights', ${i}, -1)">−</button>
      <button class="btn sm" onclick="act('nights', ${i}, 1)">+</button></div>` : ''}
    ${s.type !== 'start' ? `<div class="resv"><label><input type="checkbox" ${s.extra?.reserved ? 'checked' : ''} onchange="act('reserve', ${i}, this.checked)">
      📌 Réservation (date et nuits fixes)</label>
      ${s.extra?.reserved ? `<input placeholder="Camping, n° de réservation…" value="${esc(s.extra.resName || '')}" onchange="act('resName', ${i}, this.value)">` : ''}</div>` : ''}
    ${isNight(s) ? resvHtml(i) : ''}
    ${s.type !== 'start' ? altsHtml(s, i) : ''}
    ${isNight(s) || s.extra?.ferry ? `<div class="money">💲
      ${isNight(s) ? `<label>Prévu/nuit <input type="number" min="0" step="1" placeholder="${s.type === 'c' ? settings.campRate : 0}" value="${s.extra?.price ?? ''}" onchange="act('money', ${i}, ['price', this.value])"></label>
      <label>Payé <input type="number" min="0" step="0.01" value="${s.extra?.paid ?? ''}" onchange="act('money', ${i}, ['paid', this.value])"></label>` : ''}
      ${s.extra?.ferry ? `<label>⛴ Prévu <input type="number" min="0" step="1" placeholder="${settings.ferryRate}" value="${s.extra?.ferryCost ?? ''}" onchange="act('money', ${i}, ['ferryCost', this.value])"></label>
      <label>⛴ Payé <input type="number" min="0" step="0.01" value="${s.extra?.ferryPaid ?? ''}" onchange="act('money', ${i}, ['ferryPaid', this.value])"></label>` : ''}</div>` : ''}
    ${s.type !== 'start' ? `<details class="journal"${s.extra?.journal ? ' open' : ''}><summary>📔 Journal${s.extra?.journal ? ' ✔' : ''}</summary>
      <textarea rows="3" placeholder="Souvenirs, coups de cœur, à éviter, conseils pour la prochaine fois…" onchange="act('journal', ${i}, this.value)">${esc(s.extra?.journal || '')}</textarea></details>` : ''}
    ${s.type !== 'start' ? `<div class="addr"><input placeholder="Adresse (camping, rue, ville…)" value="${esc(s.extra?.addr || '')}" onchange="act('addr', ${i}, this.value)">
      <a class="btn sm" href="${goUrl(s)}" target="_blank" rel="noopener" title="Itinéraire dans Google Maps">🧭 Y aller</a></div>` : ''}
    <label class="gps">GPS <input value="${gpsText(s)}" title="${esc(GPS_HELP)}" onchange="act('gps', ${i}, this.value)"></label>
    ${s.type !== 'start' ? `<label style="display:block;margin-top:4px"><input type="checkbox" ${leaveRigAt(s) ? 'checked' : ''} onchange="act('leaveRig', ${i}, this.checked)">
      La fifth wheel peut rester sur place <span class="src">(découvertes à ${stopRadiusKm(s)} km)</span></label>` : ''}
    <div class="row">
      ${canType ? `<button class="btn sm" onclick="act('type', ${i})">→ ${s.type === 'b' ? 'Camping' : 'Boondock'}</button>` : ''}
      <button class="btn sm" onclick="act('nuit', ${i})">Nuitée →</button>
      ${s.type !== 'start' ? `<button class="btn sm" onclick="openDiscover(${i})">🧭 Découvrir →</button>` : ''}
      ${canType ? `<button class="btn sm" onclick="act('del', ${i})">Supprimer</button>` : ''}
    </div>
  </div>`;
}

function renderMarkers() {
  ['ends', 'b', 'c'].forEach(k => layers[k].clearLayers());
  markers.clear();
  let n = 0;
  trip.steps.forEach((s, i) => {
    if (isNight(s)) n++;
    const m = L.marker([s.lat, s.lng], { icon: markerIcon(s, n), draggable: true, title: s.name });
    m.bindPopup(() => popupHtml(trip.steps.indexOf(s)), { minWidth: 230 });
    m.on('drag', e => previewDrag(trip.steps.indexOf(s), e.target.getLatLng()));
    m.on('dragend', e => {
      const ll = e.target.getLatLng();
      s.lat = ll.lat; s.lng = ll.lng;
      layers.preview.clearLayers();
      saveTrip(); recompute();
    });
    m.addTo(isNight(s) ? layers[s.type] : layers.ends);
    markers.set(s.id, m);
  });
}

// Pendant un glissement : lignes droites pointillées vers les étapes voisines
function previewDrag(i, ll) {
  layers.preview.clearLayers();
  const pts = [trip.steps[i - 1], { lat: ll.lat, lng: ll.lng }, trip.steps[i + 1]].filter(Boolean).map(p => [p.lat, p.lng]);
  L.polyline(pts, { color: '#b4733d', weight: 3, dashArray: '6 6' }).addTo(layers.preview);
}

// Tracé redessiné seulement s'il a changé (changer des nuits ou le type d'une étape n'y touche pas)
let drawnKey = [];
function renderLines() {
  const key = legs.flatMap(l => [l.coords, l.provider]);
  const same = key.length === drawnKey.length && key.every((k, i) => k === drawnKey[i]);
  drawnKey = key;
  if (!same) layers.lines.clearLayers();
  layers.fuel.clearLayers();
  if (!same) legs.forEach(leg => {
    const style = leg.provider === 'ferry' ? { color: '#3d6fb4', weight: 3, opacity: .9, dashArray: '2 8' }
      : leg.provider === 'estimate' ? { color: '#777', weight: 3, opacity: .8, dashArray: '6 8' }
      : leg.provider === 'ors-car' ? { color: '#b4733d', weight: 4, opacity: .9 }
      : { color: '#222', weight: 4, opacity: .8 };
    L.polyline(leg.coords, style).addTo(layers.lines);
  });

  // Pleins prévus : décomptés depuis le dernier plein complet réel s'il est près du trajet
  const real = lastFullOnRoute();
  fuelPts = pointsAlong(legs, fuelKm(), real ? real.km : 0);
  fuelPts.forEach((p, k) => {
    const a = trip.steps[p.leg], b = trip.steps[p.leg + 1];
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="fu"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
      .bindPopup(`<div class="pop"><b>■ Plein #${k + 1}</b><div>km ~${fmt(p.km)} · réservoir à 50 %</div>
        ${real ? `<div class="src">Compté depuis votre plein du ${esc(real.fill.at.slice(0, 10))}${real.fill.place ? ' (' + esc(real.fill.place) + ')' : ''}</div>` : ''}
        <div class="src">Entre ${esc(a.name.split(',')[0])} et ${esc(b.name.split(',')[0])}. Chercher une station facile dans un rayon de 30 km.</div>
        <div class="row"><button class="btn sm" onclick="openView('fuel')">Détails carburant →</button></div></div>`)
      .addTo(layers.fuel);
  });

  renderList();
  renderTripTitle();
  renderCalendar();
  queueKpis();
  renderFuelTable();
  renderStations();
  renderClearances();
  renderPois();
  renderStatus();
  loadStations();
  loadClearances();
  loadPois();
  queueChains();
  queueCamps();
  queueCoe();
}

let linesQueued = false;
function queueRenderLines() {
  if (linesQueued) return;
  linesQueued = true;
  // setTimeout plutôt que requestAnimationFrame : ce dernier est suspendu quand la page est cachée
  setTimeout(() => { linesQueued = false; renderLines(); }, 60);
}

// ---------- Calcul des tronçons ----------
let routeGen = 0, routeErrors = 0;
function recompute() {
  const gen = ++routeGen;
  routeErrors = 0;
  const opts = routeOpts();
  legs = trip.steps.slice(1).map((b, i) => cachedOrEstimate(trip.steps[i], b, opts));
  renderLines();
  fetchMissing(trip.steps, opts, {
    onLeg: (i, leg) => { legs[i] = leg; queueRenderLines(); },
    onError: (i, e) => { routeErrors++; legs[i].pending = false; console.warn('Tronçon', i, e); queueRenderLines(); },
    isStale: () => gen !== routeGen,
  }).then(() => {
    // Tronçons refusés (limite de débit, réseau) : nouvel essai une minute plus tard
    if (routeErrors && gen === routeGen) setTimeout(() => { if (gen === routeGen) recompute(); }, 65000);
  });
}

function renderStatus() {
  const total = legs.length;
  const pending = legs.filter(l => l.pending).length;
  const p = providerOf(routeOpts());
  const el = $('routeStatus');
  if (pending) {
    el.textContent = `Calcul du trajet… ${total - pending}/${total} tronçons`;
    el.className = 'chip';
  } else if (routeErrors) {
    el.textContent = `${routeErrors} tronçon(s) non calculé(s) · estimation`;
    el.className = 'chip x';
  } else {
    el.textContent = p === 'ors' ? 'Trajet poids lourd (ORS)' : 'Trajet auto (OSRM) · sans restrictions VR';
    el.className = 'chip ' + (p === 'ors' ? 'c' : 'b');
  }
  $('provName').textContent = PROVIDER_LABEL[p];
  const next = fuelPts[0];
  $('hudFuel').textContent = next ? `${fuelPts.length} pleins · 1er à ~${fmt(next.km)} km` : 'Aucun plein requis';
  const sp = stationProgress(legs);
  const easy = stations.filter(s => s.level === 1).length;
  $('hudSt').textContent = sp.done < sp.total
    ? `⛽ Stations… ${sp.done}/${sp.total} tronçons${stationErrors ? ` · ${stationErrors} en erreur` : ''}`
    : `⛽ ${stations.filter(s => s.level).length} stations diesel · ${easy} faciles`;
  const cp = clearanceProgress(legs), danger = clearances.filter(c => c.danger).length;
  $('hudClear').textContent = cp.done < cp.total
    ? `⚠ Passages bas… ${cp.done}/${cp.total}${clearErrors ? ` · ${clearErrors} en erreur` : ''}`
    : `⚠ ${clearances.length} passage(s) bas${danger ? ` · ${danger} trop bas` : ''}`;
  $('hudClear').className = 'chip' + (danger ? ' x' : '');
  const pp = poiProgress(legs);
  $('hudPoi').textContent = pp.done < pp.total
    ? `🧭 Découvertes… ${pp.done}/${pp.total} tronçons${poiErrors ? ` · ${poiErrors} en erreur` : ''}`
    : `🧭 ${pois.filter(p => p.mode !== 'check').length} découvertes`;
}

// ---------- Découvertes : sentiers, points de vue, musées, histoire (OpenStreetMap) ----------
// En pause : le serveur Overpass public n'arrive pas à répondre à ces requêtes (délais, 502).
// Les lieux déjà en cache restent affichés ; à réactiver quand la recherche sera découpée autrement.
const POI_OSM_ENABLED = false;
$('hudPoi').hidden = !POI_OSM_ENABLED;
let poiBusy = false, poiErrors = 0;
async function loadPois() {
  if (!POI_OSM_ENABLED) return;
  if (poiBusy || legs.some(l => l.pending)) return;   // attendre le trajet complet
  const pp = poiProgress(legs);
  if (pp.done === pp.total) return;
  poiBusy = true;
  poiErrors = 0;
  const snapshot = legs.slice();
  await fetchMissingPois(snapshot, trip.steps, {
    onLeg: () => { renderPois(); renderStatus(); },
    onError: (i, e) => { poiErrors++; console.warn('Découvertes, tronçon', i, e); renderStatus(); },
    isStale: () => legs.length !== snapshot.length || legs.some((l, i) => l !== snapshot[i]),
  });
  poiBusy = false;
  setTimeout(loadPois, poiErrors ? 60000 : 0);
}

const POI_MODE = {
  stop: 'Autour de l\'étape',
  route: 'En route · accessible au rig',
  check: 'En route · accès rig à vérifier',
};
const poiShown = p => (p.mode !== 'check' || $('poiCheck').checked)
  && document.querySelector(`[data-poi=${p.c}]`)?.checked;

const poiIcon = p => {
  const size = p.notable ? 24 : 20;
  return L.divIcon({ className: '', html: `<div class="poi${p.notable ? ' star' : ''}${p.mode === 'check' ? ' check' : ''}">${CATS[p.c].icon}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
};

function poiAccess(p) {
  if (p.mode === 'stop') {
    const s = trip.steps[p.stop];
    return `À ${p.dStop.toFixed(1).replace('.', ',')} km de ${esc(s.name.split(',')[0])}${leaveRigAt(s) ? ' · fifth wheel laissée sur place' : ' · avec le rig ou en camion seul'}`;
  }
  const off = `à ${p.off.toFixed(1).replace('.', ',')} km du trajet (km ~${fmt(p.km)})`;
  if (p.rigParking) return `${off} · stationnement grand véhicule à proximité`;
  if (p.mode === 'route') return `${off} · halte en bordure de route`;
  return `${off} · accès avec le rig non confirmé`;
}

function poiPopup(p) {
  const wiki = wikiLink(p);
  return `<div class="pop">
    <span class="chip">${CATS[p.c].icon} ${CATS[p.c].label}</span>${p.notable ? ' <span class="chip" title="Article Wikipédia / Wikidata">⭐ reconnu</span>' : ''}
    <div><b>${esc(p.n)}</b></div>
    <div class="src">${POI_MODE[p.mode]}<br>${poiAccess(p)}</div>
    ${p.d ? `<div class="src">${esc(p.d)}</div>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewPoi('${p.id}')">Vue satellite</button>
      ${wiki ? `<a class="btn sm" target="_blank" rel="noopener" href="${wiki}">Wikipédia ↗</a>` : ''}
      ${p.web ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(p.web)}">Site ↗</a>` : ''}
    </div>
  </div>`;
}

function renderPois() {
  pois = poisAlong(legs, trip.steps);
  layers.pois.clearLayers();
  pois.filter(poiShown).forEach(p => {
    L.marker([p.lat, p.lng], { icon: poiIcon(p), title: p.n, zIndexOffset: p.notable ? 300 : 100 })
      .bindPopup(() => poiPopup(p), { minWidth: 230 })
      .addTo(layers.pois);
  });
  if ($('decouv').classList.contains('on')) renderDiscoverLists();
}
document.querySelectorAll('[data-poi]').forEach(cb => cb.onchange = renderPois);
$('publicLands').onchange = e => {
  e.target.checked ? publicLands.addTo(map) : map.removeLayer(publicLands);
  $('publicLegend').hidden = !e.target.checked;
};
$('poiCheck').onchange = renderPois;

window.viewPoi = id => {
  const p = pois.find(x => x.id === id);
  if (!p) return;
  openView('map');
  if (!viewBefore) viewBefore = { base: settings.baseMap, center: map.getCenter(), zoom: map.getZoom() };
  if (settings.baseMap !== 'sat') document.querySelector('[name=base][value=sat]').click();
  showBack();
  map.flyTo([p.lat, p.lng], 16, { duration: .8 });
  setTimeout(() => layers.pois.eachLayer(m => { if (m.getLatLng().equals([p.lat, p.lng])) m.openPopup(); }), 900);
};

// ---------- iOverlander (export personnel, synchronisé en privé) ----------
// Des milliers de points : dessinés sur un canevas, et seulement à partir du zoom 8
const IO_MIN_ZOOM = 8;
const ioRenderer = L.canvas({ padding: 0.5 });
const ioLayer = L.layerGroup();
const ioGroupOn = g => document.querySelector(`[data-io=${g}]`)?.checked;
// Pastille ronde de la couleur de la catégorie, avec son icône (⛺ 🏕 💧 🚽…), dessinée sur le canevas
// (des milliers de points : pas d'éléments HTML). Taille selon le zoom ; anneau orange = gros équipement.
const ioRadius = () => { const z = map.getZoom(); return z >= 13 ? 13 : z >= 11 ? 11 : z >= 10 ? 9 : 7; };
// Une icône emoji se dessine lentement (fillText) : chaque icône est dessinée une fois par taille dans
// une petite image réutilisée, et seulement pour les points à l'écran (sinon la carte gelait des secondes).
const ioSprites = new Map();
function ioSprite(icon, r) {
  const key = icon + r;
  if (!ioSprites.has(key)) {
    const px = Math.round(r * 1.15), size = px * 2, dpr = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.font = `${px}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icon, size / 2, size / 2 + 1);
    ioSprites.set(key, { c, size });
  }
  return ioSprites.get(key);
}
const IoMarker = L.CircleMarker.extend({
  _updatePath() {
    this._renderer._updateCircle(this);
    const ctx = this._renderer._ctx, p = this._point, r = this._radius;
    if (!ctx || !this.options.icon || r < 8 || this._empty()) return;
    const { c, size } = ioSprite(this.options.icon, r);
    ctx.drawImage(c, p.x - size / 2, p.y - size / 2, size, size);
  },
});
// « Gros équipement seulement » : les nuits non marquées big rig friendly sont cachées (services et avertissements restent)
const ioShown = x => !settings.ioBigOnly || BY_K[x[3]]?.g !== 'night' || x[4] === 1;

function ioPopup(x) {
  const c = BY_K[x[3]], p = { lat: x[0], lng: x[1] };
  let near = -1, d = Infinity;
  trip.steps.forEach((s, i) => { const k = hav(s, p); if (k < d) { d = k; near = i; } });
  return `<div class="pop">
    <span class="chip" style="border-color:${c.color};color:${c.color}">${c.icon} ${c.label}</span>
    <div><b>${esc(x[2] || 'Sans nom')}</b></div>
    ${x[4] === 1 ? '<div>🚛 Gros équipement (big rig friendly)</div>' : ''}
    <div class="src">À ${fmt(d)} km de ${esc(trip.steps[near].name.split(',')[0])} · source : iOverlander</div>
    ${c.g === 'night' ? favBtn({ name: x[2] || c.label, lat: x[0], lng: x[1], note: c.label + (x[4] === 1 ? ' · 🚛 gros équipement' : '') + ' · iOverlander' }) : ''}
    ${c.g === 'night' && trip.steps[near].type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(x[2] || c.label))}, '${x[0]}, ${x[1]}'])">🔁 Choix de rechange pour ${esc(trip.steps[near].name.split(',')[0])}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewAt(${x[0]}, ${x[1]}, 17)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/@${x[0]},${x[1]},300m/data=!3m1!1e3">Google Maps ↗</a>
    </div>
  </div>`;
}

function renderIo() {
  ioLayer.clearLayers();
  const list = getIo();
  $('ioCount').textContent = list.length ? `(${fmt(list.length)})` : '(aucun : importer dans ⚙)';
  $('ioInfo').textContent = list.length ? `${fmt(list.length)} lieux sur cet appareil` : '';
  $('ioBigOnly').checked = !!settings.ioBigOnly;
  $('ioBigNote').textContent = settings.ioBigOnly ? `${fmt(ioBigCount())} lieux marqués 🚛` : '';
  list.forEach(x => {
    const c = BY_K[x[3]];
    if (!c || !ioGroupOn(c.g) || !ioShown(x)) return;
    const big = x[4] === 1;
    new IoMarker([x[0], x[1]], { renderer: ioRenderer, radius: ioRadius(), icon: c.icon, color: big ? '#ff8f00' : '#fff', weight: big ? 3 : 1.5, fillColor: c.color, fillOpacity: .9 })
      .bindPopup(() => ioPopup(x), { minWidth: 220 })
      .addTo(ioLayer);
  });
  toggleIo();
  if ($('decouv').classList.contains('on')) renderDiscoverLists();
}
const toggleIo = () => {
  const show = map.getZoom() >= IO_MIN_ZOOM;
  if (show && !map.hasLayer(ioLayer)) ioLayer.addTo(map);
  if (!show && map.hasLayer(ioLayer)) map.removeLayer(ioLayer);
};
map.on('zoomend', () => {
  toggleIo();
  const r = ioRadius();
  ioLayer.eachLayer(m => m.getRadius() !== r && m.setRadius(r));
});
document.querySelectorAll('[data-io]').forEach(cb => cb.onchange = renderIo);
$('ioBigOnly').onchange = e => { settings.ioBigOnly = e.target.checked; saveSettings(); renderIo(); };
onIoChange(renderIo);

// ---------- Nuits possibles : Walmart, relais routiers, grandes chaînes (OpenStreetMap) ----------
const CHAIN_MIN_ZOOM = 7;
const chainLayer = L.layerGroup();
const chainOn = k => document.querySelector(`[data-chain=${k}]`)?.checked;

function chainPopup(x) {
  const c = CHAINS[x[2]], p = { lat: x[0], lng: x[1] };
  let near = -1, d = Infinity;
  trip.steps.forEach((s, i) => { const k = hav(s, p); if (k < d) { d = k; near = i; } });
  const name = x[3] || c.label;
  return `<div class="pop">
    <span class="chip" style="border-color:${c.color};color:${c.color}">${c.icon} ${c.label}</span>
    <div><b>${esc(name)}</b></div>
    <div class="src">⚠ ${c.tip}</div>
    <div class="src">À ${fmt(d)} km de ${esc(trip.steps[near].name.split(',')[0])} · source : OpenStreetMap</div>
    ${trip.steps[near].type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(name))}, '${x[0]}, ${x[1]}'])">🔁 Choix de rechange pour ${esc(trip.steps[near].name.split(',')[0])}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewAt(${x[0]}, ${x[1]}, 18)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${x[0]},${x[1]}">Google Maps ↗</a>
    </div>
  </div>`;
}

function renderChains() {
  chainLayer.clearLayers();
  const list = chainsNear(legs, trip.steps);
  if (!list) { $('chainCount').textContent = ''; return; }
  const counts = {};
  list.forEach(x => {
    const c = CHAINS[x[2]];
    if (!c) return;
    counts[x[2]] = (counts[x[2]] || 0) + 1;
    if (!chainOn(x[2])) return;
    new IoMarker([x[0], x[1]], { renderer: ioRenderer, radius: Math.max(ioRadius(), 9), icon: c.icon, color: '#fff', weight: 2, fillColor: c.color, fillOpacity: .95 })
      .bindPopup(() => chainPopup(x), { minWidth: 230 })
      .addTo(chainLayer);
  });
  document.querySelectorAll('[data-chain]').forEach(cb => {
    const n = cb.parentElement.querySelector('.src');
    if (n) n.textContent = counts[cb.dataset.chain] ? `(${counts[cb.dataset.chain]})` : '';
  });
  $('chainCount').textContent = `(${fmt(list.length)} près du trajet)`;
  toggleChains();
}
const toggleChains = () => {
  const show = map.getZoom() >= CHAIN_MIN_ZOOM;
  if (show && !map.hasLayer(chainLayer)) chainLayer.addTo(map);
  if (!show && map.hasLayer(chainLayer)) map.removeLayer(chainLayer);
};
// Le trajet change souvent pendant son calcul : on attend qu'il se calme avant de refiltrer
let chainTimer = 0;
const queueChains = () => { clearTimeout(chainTimer); chainTimer = setTimeout(renderChains, 1500); };
map.on('zoomend', () => {
  toggleChains();
  const r = Math.max(ioRadius(), 9);
  chainLayer.eachLayer(m => m.getRadius() !== r && m.setRadius(r));
});
document.querySelectorAll('[data-chain]').forEach(cb => cb.onchange = renderChains);
loadChains().then(queueChains).catch(e => console.warn('Chaînes : fichier introuvable', e));

// ---------- Campings et parcs VR, privés et publics (OpenStreetMap) ----------
const CAMP_MIN_ZOOM = 8;
const campLayer = L.layerGroup();
const campOn = k => document.querySelector(`[data-camp=${k}]`)?.checked;
const campWho = () => document.querySelector('[name=campWho]:checked')?.value || 'all';

function campPopup(x) {
  const c = CAMP_KINDS[x[2]], p = { lat: x[0], lng: x[1] }, flags = x[6] || '';
  let near = -1, d = Infinity;
  trip.steps.forEach((s, i) => { const k = hav(s, p); if (k < d) { d = k; near = i; } });
  const name = x[3] || c.label;
  const who = flags.includes('p') ? 'Public' : flags.includes('x') ? 'Privé' : '';
  const serv = [...flags].map(f => CAMP_FLAGS[f]).filter(Boolean).join(' · ');
  return `<div class="pop">
    <span class="chip" style="border-color:${c.color};color:${c.color}">${c.icon} ${c.label}${who ? ' · ' + who : ''}</span>
    <div><b>${esc(name)}</b></div>
    ${serv ? `<div>${serv}</div>` : ''}
    ${x[7] ? `<div>📏 Longueur max. : ${esc(x[7])}</div>` : ''}
    ${x[4] ? `<div>📞 <a href="tel:${esc(x[4].replace(/[^\d+]/g, ''))}">${esc(x[4])}</a></div>` : ''}
    ${x[5] ? `<div>🌐 <a href="${esc(x[5])}" target="_blank" rel="noopener">Site web ↗</a></div>` : ''}
    <div class="src">⚠ Vérifier la place pour 55 pi (camion + fifth wheel) et l'ouverture en saison.</div>
    ${favBtn({ name, lat: x[0], lng: x[1], note: [who, serv].filter(Boolean).join(' · '), web: x[5] || '', tel: x[4] || '' })}
    <div class="src">À ${fmt(d)} km de ${esc(trip.steps[near].name.split(',')[0])} · source : OpenStreetMap</div>
    ${trip.steps[near].type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(name))}, '${x[0]}, ${x[1]}'])">🔁 Choix de rechange pour ${esc(trip.steps[near].name.split(',')[0])}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewAt(${x[0]}, ${x[1]}, 17)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${x[0]},${x[1]}">Google Maps ↗</a>
    </div>
  </div>`;
}

function renderCamps() {
  campLayer.clearLayers();
  const list = campsNear(legs, trip.steps);
  if (!list) { $('campCount').textContent = ''; return; }
  const who = campWho(), counts = {};
  list.forEach(x => {
    const c = CAMP_KINDS[x[2]], f = x[6] || '';
    if (!c) return;
    counts[x[2]] = (counts[x[2]] || 0) + 1;
    if (!campOn(x[2]) || (who === 'x' && !f.includes('x')) || (who === 'p' && !f.includes('p'))) return;
    new IoMarker([x[0], x[1]], { renderer: ioRenderer, radius: Math.max(ioRadius(), 9), icon: c.icon, color: f.includes('e') ? '#ffd54f' : '#fff', weight: 2, fillColor: c.color, fillOpacity: .95 })
      .bindPopup(() => campPopup(x), { minWidth: 230 })
      .addTo(campLayer);
  });
  document.querySelectorAll('[data-camp]').forEach(cb => {
    const n = cb.parentElement.querySelector('.src');
    if (n) n.textContent = counts[cb.dataset.camp] ? `(${counts[cb.dataset.camp]})` : '';
  });
  $('campCount').textContent = `(${fmt(list.length)} près du trajet)`;
  toggleCamps();
}
const toggleCamps = () => {
  const show = map.getZoom() >= CAMP_MIN_ZOOM;
  if (show && !map.hasLayer(campLayer)) campLayer.addTo(map);
  if (!show && map.hasLayer(campLayer)) map.removeLayer(campLayer);
};
let campTimer = 0;
const queueCamps = () => { clearTimeout(campTimer); campTimer = setTimeout(renderCamps, 1600); };
map.on('zoomend', () => {
  toggleCamps();
  const r = Math.max(ioRadius(), 9);
  campLayer.eachLayer(m => m.getRadius() !== r && m.setRadius(r));
});
document.querySelectorAll('[data-camp], [name=campWho]').forEach(cb => cb.onchange = renderCamps);
loadCamps().then(queueCamps).catch(e => console.warn('Campings : fichier introuvable', e));

// ---------- 🏛 Campings du Corps of Engineers (recreation.gov), à 40 km du trajet ----------
const COE_MIN_ZOOM = 6, COE_COLOR = '#1565c0';
const coeLayer = L.layerGroup();
const coePrice = x => x[6] == null ? '' : x[6] === x[7] || x[7] == null ? `${x[6]} $ US / nuit` : `${x[6]} à ${x[7]} $ US / nuit`;
function coePopup(x) {
  const { i: near, d } = nearestStep({ lat: x[0], lng: x[1] }), st = trip.steps[near], city = esc(st.name.split(',')[0]);
  const note = ['Corps of Engineers', x[3], coePrice(x), 'recreation.gov'].filter(Boolean).join(' · ');
  return `<div class="pop">
    <span class="chip" style="border-color:${COE_COLOR};color:${COE_COLOR}">🏛 Corps of Engineers · public</span>
    <div><b>${esc(x[2])}</b></div>
    <div>${esc(x[3])}${x[4] ? ', ' + esc(x[4]) : ''}</div>
    ${coePrice(x) ? `<div>💲 ${coePrice(x)}</div>` : ''}
    <div>📅 <a href="https://www.recreation.gov/camping/campgrounds/${esc(x[5])}" target="_blank" rel="noopener">Fiche et réservation (recreation.gov) ↗</a></div>
    ${resvPlaceHtml({ name: `${x[2]} (Corps of Engineers), ${x[3]}`, lat: x[0], lng: x[1] })}
    <div class="src">⚠ Plusieurs ferment l'hiver : vérifier la saison et la place pour 55 pi.</div>
    ${favBtn({ name: x[2] + ' (Corps of Engineers)', lat: x[0], lng: x[1], note, web: 'https://www.recreation.gov/camping/campgrounds/' + x[5] })}
    <div class="src">À ${fmt(d)} km de ${city}</div>
    ${st.type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(x[2]))}, '${x[0]}, ${x[1]}'])">🔁 Choix de rechange pour ${city}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewAt(${x[0]}, ${x[1]}, 17)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${x[0]},${x[1]}">Google Maps ↗</a>
    </div>
  </div>`;
}
function renderCoe() {
  coeLayer.clearLayers();
  const list = coeNear(legs, trip.steps);
  if (!list) { $('coeCount').textContent = ''; return; }
  list.forEach(x => new IoMarker([x[0], x[1]], { renderer: ioRenderer, radius: Math.max(ioRadius(), 9), icon: '🏛', color: '#fff', weight: 2, fillColor: COE_COLOR, fillOpacity: .95 })
    .bindPopup(() => coePopup(x), { minWidth: 230 }).addTo(coeLayer));
  $('coeCount').textContent = `(${fmt(list.length)})`;
  toggleCoe();
}
const toggleCoe = () => {
  const show = $('coeShow').checked && map.getZoom() >= COE_MIN_ZOOM;
  if (show && !map.hasLayer(coeLayer)) coeLayer.addTo(map);
  if (!show && map.hasLayer(coeLayer)) map.removeLayer(coeLayer);
};
let coeTimer = 0;
const queueCoe = () => { clearTimeout(coeTimer); coeTimer = setTimeout(renderCoe, 1700); };
map.on('zoomend', () => {
  toggleCoe();
  const r = Math.max(ioRadius(), 9);
  coeLayer.eachLayer(m => m.getRadius() !== r && m.setRadius(r));
});
$('coeShow').onchange = toggleCoe;
loadCoe().then(queueCoe).catch(e => console.warn('Corps of Engineers : fichier introuvable', e));

// ---------- 📅 Aide à la réservation (dates de l'itinéraire + paramètres du rig, lien vers le bon site) ----------
function resvInfo(i) {
  const s = trip.steps[i], a = arrival(i);
  return { s, arr: toIso(a), dep: toIso(addDays(a, s.nights)), nights: s.nights };
}
function resvHtml(i) {
  const { s, arr, dep, nights } = resvInfo(i), p = settings.resv;
  const sites = resvSites(s, coeAll());
  const eq = RESV_EQUIP[p.equip]?.[0] || '', amps = RESV_AMPS[p.amps]?.[0] || '';
  return `<details class="resv-help"><summary>📅 Réserver cet endroit</summary>
    <div>Du <b>${shortDate(parseIso(arr))}</b> au <b>${shortDate(parseIso(dep))}</b> (${nights} nuit${nights > 1 ? 's' : ''})</div>
    <div class="src">${esc(eq)} ${p.trailerFt} pi (total ${p.totalFt} pi) · ${esc(amps)} · ${p.adults} adulte${p.adults > 1 ? 's' : ''}${p.pets ? ` · ${p.pets} animal${p.pets > 1 ? 'aux' : ''}` : ''} ·
      <a href="#" onclick="openResvSettings(); return false">modifier les paramètres</a></div>
    <button class="btn sm" onclick="resvCopy(${i}, this)">📋 Copier les infos de réservation</button>
    <div class="row">${sites.map(([t, u]) => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(u)}">${esc(t)} ↗</a>`).join('')}</div>
    <div class="src">Collez les infos dans le site de réservation (dates, longueur, électricité…). Après la réservation, cochez « 📌 Réservation » ci-dessus et notez le numéro.</div>
  </details>`;
}
window.resvCopy = async (i, btn) => {
  const { s, arr, dep, nights } = resvInfo(i);
  const txt = resvText(s, arr, dep, nights, settings.resv);
  try { await navigator.clipboard.writeText(txt); btn.textContent = '✔ Copié'; }
  catch { prompt('Copiez ce texte :', txt); }
};
// Même aide pour un endroit hors itinéraire (camping du Corps, favori) : dates choisies dans la fiche,
// proposées d'après l'étape la plus proche.
const resvPlaces = [];
function resvPlaceHtml(pl) {
  const k = resvPlaces.push(pl) - 1, { i: near } = nearestStep(pl), st = trip.steps[near];
  const nights = isNight(st) ? st.nights : 1, p = settings.resv;
  const eq = RESV_EQUIP[p.equip]?.[0] || '', amps = RESV_AMPS[p.amps]?.[0] || '';
  const sites = resvSites(pl, coeAll());
  return `<details class="resv-help"><summary>📅 Réserver cet endroit</summary>
    <div>Arrivée <input type="date" id="resvA${k}" style="width:auto" value="${toIso(arrival(near))}">
      Nuits <input type="number" id="resvN${k}" min="1" max="60" style="width:56px" value="${nights}"></div>
    <div class="src">Dates proposées d'après l'étape la plus proche (${esc(st.name.split(',')[0])}).</div>
    <div class="src">${esc(eq)} ${p.trailerFt} pi (total ${p.totalFt} pi) · ${esc(amps)} · ${p.adults} adulte${p.adults > 1 ? 's' : ''}${p.pets ? ` · ${p.pets} animal${p.pets > 1 ? 'aux' : ''}` : ''} ·
      <a href="#" onclick="openResvSettings(); return false">modifier les paramètres</a></div>
    <button class="btn sm" onclick="resvCopyPlace(${k}, this)">📋 Copier les infos de réservation</button>
    <div class="row">${sites.map(([t, u]) => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(u)}">${esc(t)} ↗</a>`).join('')}</div>
  </details>`;
}
window.resvCopyPlace = async (k, btn) => {
  const pl = resvPlaces[k], a = $('resvA' + k)?.value, n = Math.max(1, parseInt($('resvN' + k)?.value) || 1);
  if (!pl || !a) return;
  const txt = resvText(pl, a, toIso(addDays(parseIso(a), n)), n, settings.resv);
  try { await navigator.clipboard.writeText(txt); btn.textContent = '✔ Copié'; }
  catch { prompt('Copiez ce texte :', txt); }
};
window.openResvSettings = () => { openView('params'); setTimeout(() => $('resvBox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); };
// ⚙ Paramètres : chaque champ data-resv modifie settings.resv
document.querySelectorAll('[data-resv]').forEach(el => {
  const v = settings.resv[el.dataset.resv];
  if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  el.onchange = () => {
    const k = el.dataset.resv;
    settings.resv[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, parseFloat(el.value) || 0) : el.value;
    saveSettings();
  };
});

// ---------- ⭐ Mes campings favoris (toujours visibles, synchronisés) ----------
const favLayer = L.layerGroup().addTo(map);
const favIcon = L.divIcon({ className: 'fav-ico', html: '⭐', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12] });
// Données des boutons ⭐ des fiches (trop longues pour un attribut onclick)
const favPending = new Map();
function favBtn(f) {
  const key = `${f.lat},${f.lng}`;
  favPending.set(key, f);
  const on = favAt(f.lat, f.lng);
  return `<button class="btn sm fav-btn${on ? ' on' : ''}" onclick="favToggle('${key}')">${on ? '⭐ Dans mes favoris (retirer)' : '☆ Ajouter à mes campings favoris'}</button>`;
}
window.favToggle = key => {
  const f = favPending.get(key), on = f && favAt(f.lat, f.lng);
  if (!f) return;
  if (on) delFav(on.id); else addFav(f);
  map.closePopup();
};
function favPopup(f) {
  const { i: near, d } = nearestStep(f), st = trip.steps[near], city = esc(st.name.split(',')[0]);
  return `<div class="pop">
    <span class="chip" style="border-color:#f9a825;color:#b07800">⭐ Mon camping favori</span>
    <div><b>${esc(f.name)}</b></div>
    ${f.note ? `<div>${esc(f.note)}</div>` : ''}
    ${f.tel ? `<div>📞 <a href="tel:${esc(f.tel.replace(/[^\d+]/g, ''))}">${esc(f.tel)}</a></div>` : ''}
    ${f.web ? `<div>🌐 <a href="${esc(f.web)}" target="_blank" rel="noopener">Site web ↗</a></div>` : ''}
    ${resvPlaceHtml(f)}
    <div class="src">${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} · à ${fmt(d)} km de ${city}</div>
    ${st.type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(f.name))}, '${f.lat}, ${f.lng}'])">🔁 Choix de rechange pour ${city}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="favNote('${f.id}')">✏ Note</button>
      <button class="btn sm" onclick="viewAt(${f.lat}, ${f.lng}, 17)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}">Y aller ↗</a>
      <button class="btn sm" onclick="if (confirm('Retirer ce camping de mes favoris ?')) favDel('${f.id}')">✕</button>
    </div>
  </div>`;
}
window.favNote = id => {
  const f = getFavs().find(x => x.id === id);
  if (!f) return;
  const note = prompt('Note pour ' + f.name, f.note || '');
  if (note !== null) editFav(id, { note: note.trim().slice(0, 600) });
};
window.favDel = id => { delFav(id); map.closePopup(); };
function renderFavs() {
  favLayer.clearLayers();
  const list = getFavs(), show = $('favShow')?.checked !== false;
  $('favCount').textContent = list.length ? `(${list.length})` : '';
  if (show) list.forEach(f => L.marker([f.lat, f.lng], { icon: favIcon, zIndexOffset: 1000, title: f.name })
    .bindPopup(() => favPopup(f), { minWidth: 230 }).addTo(favLayer));
  const ul = $('favList');
  if (ul) ul.innerHTML = list.map(f => `<li><a href="#" onclick="goTo(${f.lat}, ${f.lng}, 12); return false">⭐ ${esc(f.name)}</a></li>`).join('');
}
$('favShow').onchange = renderFavs;
$('favAdd').onclick = () => {
  const name = $('favName').value.trim(), p = parseGps($('favWhere').value);
  if (!p) { alert('Position GPS non reconnue.\n' + GPS_HELP); return; }
  addFav({ name: name || 'Camping', ...p });
  $('favName').value = $('favWhere').value = '';
  goTo(p.lat, p.lng, 12);
};
onFavsChange(() => { renderFavs(); syncNow(); });
renderFavs();
// Lien d'ajout : …/cap-ouest/#fav=Nom|lat,lng|note (ex. envoyé par Claude) : ajoute le favori à l'ouverture
function favFromHash() {
  const m = location.hash.match(/^#fav=(.*)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const [name, where, note] = decodeURIComponent(m[1].replace(/\+/g, ' ')).split('|');
  const p = parseGps(where || '');
  if (!p) return;
  const had = favAt(p.lat, p.lng);
  addFav({ name, ...p, note: note || '' });
  goTo(p.lat, p.lng, 11);
  setTimeout(() => alert(had ? `⭐ ${name} est déjà dans vos campings favoris.` : `⭐ ${name} est ajouté à vos campings favoris.`), 300);
}
window.addEventListener('hashchange', favFromHash);
setTimeout(favFromHash, 0);   // après la définition de goTo / openView plus bas

// Aller à un point sur le plan (sans passer en satellite, contrairement à viewAt)
window.goTo = (lat, lng, zoom) => {
  openView('map');
  map.setView([lat, lng], Math.max(zoom, map.getZoom()));
};

// ---------- 🔍 Recherche : étapes, favoris, guides, iOverlander, campings (tout le continent), villes / adresses, GPS ----------
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let campsAll = null;
const searchHits = [];
function placePopup(r) {
  const { i: near, d } = nearestStep(r), st = trip.steps[near], city = esc(st.name.split(',')[0]);
  return `<div class="pop">
    <div><b>${esc(r.name)}</b></div>
    ${r.sub ? `<div class="src">${esc(r.sub)}</div>` : ''}
    <div class="src">${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} · à ${fmt(d)} km de ${city}</div>
    ${favBtn({ name: r.name, lat: r.lat, lng: r.lng, note: r.sub || '' })}
    ${st.type !== 'start' ? `<button class="btn sm" onclick="act('altAdd', ${near}, [${esc(JSON.stringify(r.name))}, '${r.lat}, ${r.lng}'])">🔁 Choix de rechange pour ${city}</button>` : ''}
    <div class="row">
      <button class="btn sm" onclick="viewAt(${r.lat}, ${r.lng}, 17)">Vue satellite</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}">Google Maps ↗</a>
    </div>
  </div>`;
}
let searchPin = null;
window.searchGo = k => {
  const r = searchHits[k];
  if (!r) return;
  goTo(r.lat, r.lng, r.zoom || 12);
  if (searchPin) { map.removeLayer(searchPin); searchPin = null; }
  if (r.step != null) setTimeout(() => markers.get(trip.steps[r.step]?.id)?.openPopup(), 50);
  else {
    if (!r.fav) searchPin = L.circleMarker([r.lat, r.lng], { radius: 14, color: '#e53935', weight: 3, fill: false, interactive: false }).addTo(map);
    L.popup({ minWidth: 240 }).setLatLng([r.lat, r.lng]).setContent(r.html()).openOn(map);
  }
  $('searchBox').hidden = true;   // la fiche reste visible ; 🔍 rouvre la recherche avec le même texte
};
function localHits(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const has = t => { const n = norm(t); return words.every(w => n.includes(w)); };
  const out = [];
  trip.steps.forEach((s, i) => has(s.name) && out.push({ g: 'Mes étapes', name: s.name, sub: i ? `Étape ${i}` : 'Départ', lat: s.lat, lng: s.lng, step: i, zoom: 11 }));
  getFavs().forEach(f => has(f.name + ' ' + f.note) && out.push({ g: '⭐ Mes favoris', name: f.name, sub: f.note, lat: f.lat, lng: f.lng, fav: true, html: () => favPopup(f) }));
  getPlaces().forEach(p => has(p.name) && out.push({ g: '📘 Mes guides', name: p.name, sub: PLACE_CATS[p.cat]?.label, lat: p.lat, lng: p.lng, html: () => guidePopup(p) }));
  getIo().filter(x => has(x[2])).slice(0, 15)
    .forEach(x => out.push({ g: '⛺ iOverlander', name: x[2], sub: BY_K[x[3]]?.label, lat: x[0], lng: x[1], html: () => ioPopup(x) }));
  (coeAll() || []).filter(x => has(x[2] + ' ' + x[3])).slice(0, 15).forEach(x => out.push({ g: '🏛 Corps of Engineers', name: x[2], lat: x[0], lng: x[1], html: () => coePopup(x),
    sub: [x[3], x[4], `à ${fmt(nearestStep({ lat: x[0], lng: x[1] }).d)} km d’une étape`].filter(Boolean).join(' · ') }));
  if (campsAll) campsAll.filter(x => has(x[3])).slice(0, 25).forEach(x => {
    const f = x[6] || '', who = f.includes('p') ? 'public' : f.includes('x') ? 'privé' : '';
    out.push({ g: '🏕 Campings et parcs VR', name: x[3], lat: x[0], lng: x[1], html: () => campPopup(x),
      sub: [CAMP_KINDS[x[2]]?.label, who, `à ${fmt(nearestStep({ lat: x[0], lng: x[1] }).d)} km d’une étape`].filter(Boolean).join(' · ') });
  });
  return out;
}
let geoHits = [], geoQ = '', geoTimer = 0, searchTimer = 0;
function renderSearch() {
  const q = $('searchQ').value.trim();
  searchHits.length = 0;
  if (q.length < 2) { $('searchRes').innerHTML = '<div class="src" style="padding:6px">Nom d’un camping, d’une étape, d’une ville, une adresse ou une position GPS.</div>'; return; }
  const gps = parseGps(q);
  const hits = [
    ...(gps ? [{ g: 'Position GPS', name: `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`, lat: gps.lat, lng: gps.lng, zoom: 14 }] : []),
    ...localHits(q),
    ...(geoQ === q ? geoHits : []),
  ];
  hits.forEach(h => { h.html ||= () => placePopup(h); searchHits.push(h); });
  let g = '';
  $('searchRes').innerHTML = hits.map((h, k) => (h.g !== g ? `<h4>${esc(g = h.g)}</h4>` : '')
    + `<button onclick="searchGo(${k})">${esc(h.name)}${h.sub ? `<small>${esc(h.sub)}</small>` : ''}</button>`).join('')
    + (geoQ !== q && q.length >= 3 && !gps ? '<div class="src" style="padding:6px">Recherche des villes et adresses…</div>'
      : !hits.length ? '<div class="src" style="padding:6px">Aucun résultat.</div>' : '');
}
// Villes et adresses : OpenStreetMap (Nominatim), États-Unis et Canada ; une requête après une pause de frappe
async function geoSearch(q) {
  if (q.length < 3 || parseGps(q)) { geoQ = q; geoHits = []; return; }
  try {
    const u = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: 6, countrycodes: 'us,ca', 'accept-language': 'fr' });
    const list = await fetch(u).then(r => r.json());
    geoHits = list.map(x => ({ g: '📍 Villes et adresses (OpenStreetMap)', name: x.display_name.split(',').slice(0, 2).join(','),
      sub: x.display_name.split(',').slice(2).join(',').trim(), lat: +x.lat, lng: +x.lon,
      zoom: x.class === 'place' || x.class === 'boundary' ? 11 : 15 }));
  } catch { geoHits = []; }
  geoQ = q;
  if ($('searchQ').value.trim() === q) renderSearch();
}
$('searchQ').oninput = () => {
  clearTimeout(searchTimer); clearTimeout(geoTimer);
  searchTimer = setTimeout(renderSearch, 200);
  const q = $('searchQ').value.trim();
  geoTimer = setTimeout(() => geoSearch(q), 900);
};
$('searchQ').onkeydown = e => {
  if (e.key === 'Enter') { clearTimeout(geoTimer); renderSearch(); if (searchHits.length === 1) searchGo(0); else geoSearch($('searchQ').value.trim()); }
  if (e.key === 'Escape') $('searchBox').hidden = true;
};
$('searchBtn').onclick = () => {
  const box = $('searchBox');
  box.hidden = !box.hidden;
  if (box.hidden) return;
  openView('map');
  loadCamps().then(list => { campsAll = list; if (!box.hidden) renderSearch(); }).catch(() => {});
  renderSearch();
  $('searchQ').focus(); $('searchQ').select();
};
$('searchClose').onclick = () => { $('searchBox').hidden = true; if (searchPin) { map.removeLayer(searchPin); searchPin = null; } };

// Résumé des lieux iOverlander proches d'une étape (fiche de l'étape)
function ioSummary(s) {
  const near = ioNear(s, 15).filter(({ x }) => ioShown(x));
  if (!near.length) return '';
  const n = k => near.filter(({ x }) => BY_K[x[3]].g === k).length;
  const by = k => near.filter(({ x }) => x[3] === k).length;
  return `<div class="src">iOverlander à 15 km : ⛺ ${n('night')} · 💧 ${by('water')} · 🚽 ${by('dump')}</div>`;
}

$('ioFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  // Le corridor se calcule sur le vrai tracé : attendre la fin du calcul du trajet
  if (legs.some(l => l.pending)) {
    $('dataMsg').textContent = '⏳ Le trajet est encore en calcul : réessayez dans une minute.';
    e.target.value = '';
    return;
  }
  $('dataMsg').textContent = 'Lecture du fichier iOverlander…';
  await new Promise(r => setTimeout(r, 30));
  try {
    const r = importIoCsv(await file.text(), legs, trip.steps, $('ioAllBig').checked);
    $('dataMsg').textContent = `✔ ${fmt(r.kept)} lieux gardés près du trajet (sur ${fmt(r.read)} utiles) · ${fmt(r.total)} au total. Ils seront envoyés à votre compte.`
      + (r.big ? ` 🚛 ${fmt(r.big)} marqués gros équipement.` : r.hasBigCol ? '' : ' (Ce fichier ne dit pas quels lieux conviennent aux gros équipements : voir l’aide sous le bouton.)');
    $('ioAllBig').checked = false;
    syncNow();
  } catch (err) {
    $('dataMsg').textContent = `✖ ${err.message}`;
  }
  e.target.value = '';
};
$('ioClear').onclick = () => {
  if (!confirm('Retirer tous les lieux iOverlander de cet appareil et de votre compte ?')) return;
  clearIo();
  syncNow();
};

// ---------- Mes guides (lieux tirés des guides personnels, synchronisés en privé) ----------
// Étape la plus proche, pour situer chaque lieu par rapport au voyage
function nearestStep(p) {
  let best = -1, d = Infinity;
  trip.steps.forEach((s, i) => { const k = hav(s, p); if (k < d) { d = k; best = i; } });
  return { i: best, d };
}

const guideIcon = p => L.divIcon({ className: '',
  html: `<div class="poi guide" style="border-color:${p.diff ? DIFF[p.diff].color : '#3d6fb4'}">${PLACE_CATS[p.cat].icon}</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12] });

function guidePopup(p) {
  const n = nearestStep(p), s = trip.steps[n.i];
  return `<div class="pop">
    <span class="chip">📘 ${PLACE_CATS[p.cat].icon} ${PLACE_CATS[p.cat].label}</span>
    ${p.diff ? `<span class="chip" style="border-color:${DIFF[p.diff].color};color:${DIFF[p.diff].color}">${DIFF[p.diff].label}</span>` : ''}
    <div><b>${esc(p.name)}</b></div>
    <div>${esc(p.note)}</div>
    <div class="src">À ${fmt(n.d)} km de ${esc(s.name.split(',')[0])} · ${esc(p.src)}</div>
    <div class="row"><button class="btn sm" onclick="viewAt(${p.lat}, ${p.lng}, 16)">Vue satellite</button></div>
  </div>`;
}

function renderGuides() {
  const list = getPlaces();
  layers.guides.clearLayers();
  list.forEach(p => {
    L.marker([p.lat, p.lng], { icon: guideIcon(p), title: p.name, zIndexOffset: 400 })
      .bindPopup(() => guidePopup(p), { minWidth: 240 })
      .addTo(layers.guides);
  });
  $('guidesCount').textContent = list.length ? `(${list.length})` : '(aucun : importer dans ⚙)';
  $('placesInfo').textContent = list.length ? `${list.length} lieux sur cet appareil` : '';
  if ($('decouv').classList.contains('on')) renderDiscoverLists();
}
onPlacesChange(renderGuides);

// Vue satellite centrée sur un point (bouton « Retour » pour revenir)
window.viewAt = (lat, lng, zoom) => {
  openView('map');
  if (!viewBefore) viewBefore = { base: settings.baseMap, center: map.getCenter(), zoom: map.getZoom() };
  if (settings.baseMap !== 'sat') document.querySelector('[name=base][value=sat]').click();
  showBack();
  map.flyTo([lat, lng], zoom, { duration: .8 });
};

$('placesFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = importPlaces(await file.text());
    $('dataMsg').textContent = `✔ ${n} lieux importés. Ils seront envoyés à votre compte à la prochaine synchronisation.`;
    syncNow();
  } catch (err) {
    $('dataMsg').textContent = `✖ ${err.message}`;
  }
  e.target.value = '';
};

// ---------- Page Découvertes (une étape à la fois) ----------
let dcIndex = 1;
const dcSteps = () => trip.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.type !== 'start');

window.openDiscover = i => {
  dcIndex = i;
  openView('decouv');
  renderDiscover();
};

function renderDiscover() {
  const list = dcSteps();
  if (!list.some(x => x.i === dcIndex)) dcIndex = list[0]?.i ?? 1;
  $('dcStep').innerHTML = list.map(({ s, i }) => `<option value="${i}" ${i === dcIndex ? 'selected' : ''}>${shortDate(arrival(i))} · ${esc(s.name)}</option>`).join('');
  const s = trip.steps[dcIndex];
  $('dcInfo').textContent = `${TYPE_LABEL[s.type]} · ${s.nights || 0} nuit(s) · rayon de découverte ${stopRadiusKm(s)} km${leaveRigAt(s) ? ' (fifth wheel laissée sur place)' : ''}`;
  renderDiscoverLists();
  renderHistory(s);
}

function poiRow(p) {
  return `<div class="pl" onclick="viewPoi('${p.id}')"><span class="i">${CATS[p.c].icon}</span>
    <div><b>${esc(p.n)}</b>${p.notable ? ' ⭐' : ''}<small>${poiAccess(p)}</small></div></div>`;
}

function renderDiscoverLists() {
  const s = trip.steps[dcIndex];
  if (!s) return;
  // Mes guides : autour de l'étape (rayon selon la fifth wheel) ou à 15 km au plus du tronçon d'arrivée
  const leg = legs[dcIndex - 1];
  const mine = getPlaces().map(p => {
    const d = hav(s, p);
    const off = leg && leg.coords.length > 1 ? project(p, leg.coords).off : Infinity;
    return { p, d, off };
  }).filter(x => x.d <= stopRadiusKm(s) || x.off <= 15).sort((a, b) => a.d - b.d);
  $('dcGuides').innerHTML = mine.length ? mine.map(({ p, d, off }) => `<div class="pl" onclick="viewAt(${p.lat}, ${p.lng}, 16)">
      <span class="i">${PLACE_CATS[p.cat].icon}</span>
      <div><b>${esc(p.name)}</b>${p.diff ? ` <span class="chip" style="border-color:${DIFF[p.diff].color};color:${DIFF[p.diff].color}">${DIFF[p.diff].label}</span>` : ''}
        <small>${esc(p.note)}</small>
        <small>${d <= stopRadiusKm(s) ? `À ${d.toFixed(1).replace('.', ',')} km de l'étape` : `En route, à ${off.toFixed(1).replace('.', ',')} km du trajet`} · ${esc(p.src)}</small></div></div>`).join('')
    : `<div class="src">${getPlaces().length ? 'Aucun lieu de vos guides près de cette étape.' : 'Importez vos lieux dans ⚙ Paramètres.'}</div>`;

  // iOverlander : les plus proches de l'étape, par groupe
  const io = ioNear(s, 15).filter(({ x }) => ioShown(x));
  $('dcIo').innerHTML = !getIo().length ? '<div class="src">Importez votre export iOverlander dans ⚙ Paramètres.</div>'
    : !io.length ? '<div class="src">Aucun lieu iOverlander à 15 km de cette étape.</div>'
    : Object.entries(GROUPS).map(([g, title]) => {
        const list = io.filter(({ x }) => BY_K[x[3]].g === g).slice(0, 10);
        return list.length ? `<h3 class="mt">${title}</h3>` + list.map(({ x, d }) => `<div class="pl" onclick="viewAt(${x[0]}, ${x[1]}, 17)">
          <span class="i">${BY_K[x[3]].icon}</span><div><b>${esc(x[2] || 'Sans nom')}</b><small>${BY_K[x[3]].label} · à ${d.toFixed(1).replace('.', ',')} km</small></div></div>`).join('') : '';
      }).join('');
  const pending = poiProgress(legs);
  const wait = pending.done < pending.total ? '<div class="src">Recherche en cours sur OpenStreetMap…</div>' : '';
  const around = pois.filter(p => p.mode === 'stop' && p.stop === dcIndex)
    .sort((a, b) => (b.notable - a.notable) || a.dStop - b.dStop);
  $('dcAroundTitle').textContent = `Autour de ${s.name.split(',')[0]} (${stopRadiusKm(s)} km)`;
  $('dcAround').innerHTML = (around.length
    ? Object.keys(CATS).map(c => {
        const g = around.filter(p => p.c === c);
        return g.length ? `<h3 class="mt">${CATS[c].icon} ${CATS[c].label} (${g.length})</h3>` + g.map(poiRow).join('') : '';
      }).join('')
    : '<div class="src">Aucun lieu trouvé dans ce rayon.</div>') + wait;
  const onLeg = pois.filter(p => p.leg === dcIndex - 1 && (p.mode === 'route' || (p.mode === 'check' && $('poiCheck').checked)));
  $('dcRoute').innerHTML = (onLeg.length ? onLeg.map(poiRow).join('')
    : '<div class="src">Aucun arrêt accessible au rig sur ce tronçon.</div>') + wait;
}

async function renderHistory(s) {
  const box = $('dcHistory');
  box.innerHTML = '<h2>📜 Histoire</h2><div class="src">Chargement depuis Wikipédia…</div>';
  try {
    const h = await cityHistory(s.name);
    if (trip.steps[dcIndex] !== s) return;   // l'utilisateur a changé d'étape entre-temps
    if (!h) { box.innerHTML = '<h2>📜 Histoire</h2><div class="src">Aucun article Wikipédia trouvé.</div>'; return; }
    box.innerHTML = `<h2>📜 ${esc(h.title)}</h2>
      ${h.thumb ? `<img class="dc-thumb" src="${esc(h.thumb)}" alt="">` : ''}
      <p>${esc(h.intro)}</p>
      ${h.history ? `<h3>Histoire</h3><p>${esc(h.history).replace(/\n/g, '<br>')}</p>` : ''}
      <a class="btn sm" target="_blank" rel="noopener" href="${esc(h.url)}">Lire sur Wikipédia ↗</a>`;
  } catch (e) {
    box.innerHTML = `<h2>📜 Histoire</h2><div class="src">Wikipédia indisponible (${esc(e.message)}).</div>`;
  }
}

$('dcStep').onchange = e => { dcIndex = +e.target.value; renderDiscover(); };
document.querySelector('nav [data-t=decouv]').addEventListener('click', renderDiscover);
const dcMove = d => {
  const list = dcSteps(), k = list.findIndex(x => x.i === dcIndex);
  const next = list[k + d];
  if (next) { dcIndex = next.i; renderDiscover(); }
};
$('dcPrev').onclick = () => dcMove(-1);
$('dcNext').onclick = () => dcMove(1);

// ---------- Stations diesel réelles (OpenStreetMap) ----------
// Une seule recherche à la fois (le serveur public refuse les requêtes simultanées) ;
// à la fin, on relance pour les tronçons modifiés entre-temps, ou dans 1 min après une erreur.
let stationBusy = false, stationErrors = 0;
async function loadStations() {
  if (stationBusy || legs.some(l => l.pending)) return;   // attendre le trajet complet
  const sp = stationProgress(legs);
  if (sp.done === sp.total) return;
  stationBusy = true;
  stationErrors = 0;
  const snapshot = legs.slice();
  await fetchMissingStations(snapshot, {
    onLeg: () => { renderStations(); renderStatus(); },
    onError: (i, e) => { stationErrors++; console.warn('Stations, tronçon', i, e); renderStatus(); },
    isStale: () => legs.length !== snapshot.length || legs.some((l, i) => l !== snapshot[i]),
  });
  stationBusy = false;
  setTimeout(loadStations, stationErrors ? 60000 : 0);
}

// ---------- Passages bas (hauteur libre d'OpenStreetMap) ----------
// Même principe que les stations : une recherche à la fois, nouvel essai dans 1 min après une erreur
let clearBusy = false, clearErrors = 0;
async function loadClearances() {
  if (clearBusy || legs.some(l => l.pending)) return;
  const cp = clearanceProgress(legs);
  if (cp.done === cp.total) return;
  clearBusy = true;
  clearErrors = 0;
  const snapshot = legs.slice();
  await fetchMissingClearances(snapshot, {
    onLeg: () => { renderClearances(); renderStatus(); },
    onError: (i, e) => { clearErrors++; console.warn('Passages bas, tronçon', i, e); renderStatus(); },
    isStale: () => legs.length !== snapshot.length || legs.some((l, i) => l !== snapshot[i]),
  });
  clearBusy = false;
  setTimeout(loadClearances, clearErrors ? 60000 : 0);
}

function renderClearances() {
  const rig = settings.vehicle.heightM;
  clearances = clearancesAlong(legs, rig);
  layers.clear.clearLayers();
  clearances.forEach(c => {
    const icon = L.divIcon({ className: '', html: `<div class="clr${c.danger ? ' danger' : ''}">${feet(c.h)}</div>`, iconSize: [52, 22], iconAnchor: [26, 11] });
    L.marker([c.lat, c.lng], { icon, title: `${c.kind} : ${feet(c.h)}`, zIndexOffset: 1500 })
      .bindPopup(() => `<div class="pop">
        <span class="chip" style="border-color:${c.danger ? '#c0392b' : '#e0661b'};color:${c.danger ? '#c0392b' : '#e0661b'}">${c.danger ? '⛔ Trop bas ou trop juste (moins de 3 po de marge)' : '⚠ Passage serré'}</span>
        <div><b>${c.kind}</b>${c.road ? ' · ' + esc(c.road) : ''}</div>
        <div>Hauteur libre : <b>${feet(c.h)}</b> (${c.h.toFixed(2).replace('.', ',')} m) · votre rig : ${feet(rig)}</div>
        <div>km ~${fmt(c.km)} du départ · à ${fmt(c.off * 1000)} m du trajet</div>
        <div class="src">Donnée OpenStreetMap : peut être incomplète ou erronée. Toujours se fier aux panneaux.</div>
      </div>`, { minWidth: 220 })
      .addTo(layers.clear);
  });
}

const stationIcon = s => {
  const size = s.level === 1 ? 20 : 12;
  return L.divIcon({ className: '', html: `<div class="st" style="background:${LEVEL[s.level].color}">${s.level === 1 ? '⛽' : ''}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
};

function stationPopup(s) {
  const lv = LEVEL[s.level];
  const brand = s.b && s.b !== s.name ? ` · ${esc(s.b)}` : '';
  return `<div class="pop">
    <span class="chip" style="border-color:${lv.color};color:${lv.color}">${s.level ? 'Niveau ' + s.level + ' · ' : ''}${lv.label}</span>
    <div><b>${esc(s.name)}</b>${brand}</div>
    <div>km ~${fmt(s.km)} du départ · à ${s.off.toFixed(1).replace('.', ',')} km du trajet</div>
    <div class="src">${s.why.map(esc).join(' · ')}${s.def ? ' · DEF à la pompe' : ''}</div>
    <div class="row">
      <button class="btn sm" onclick="viewStation('${s.id}')">Vue satellite ici</button>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/@${s.lat},${s.lng},150m/data=!3m1!1e3">Google Maps ↗</a>
    </div>
    <div class="src">Niveau automatique (OpenStreetMap) : vérifier l'entrée, l'auvent (12' 4") et la sortie.</div>
  </div>`;
}

function renderStations() {
  stations = stationsAlong(legs);
  layers.stations.clearLayers();
  // La carte suit le filtre de la page Carburant (faciles et faisables par défaut)
  stations.filter(s => s.level <= +$('stMax').value).forEach(s => {
    L.marker([s.lat, s.lng], { icon: stationIcon(s), title: s.name, zIndexOffset: s.level === 1 ? 500 : s.level === 2 ? 250 : 0 })
      .bindPopup(() => stationPopup(s), { minWidth: 230 })
      .addTo(layers.stations);
  });
  renderStationTable();
}

function renderStationTable() {
  $('stCounts').innerHTML = [1, 2, 3, 0].map(l =>
    `<span class="chip" style="border-color:${LEVEL[l].color};color:${LEVEL[l].color}">${LEVEL[l].label} : ${stations.filter(s => s.level === l).length}</span>`).join('');
  const shown = stations.filter(s => s.level && s.level <= +$('stMax').value);
  $('stTable').innerHTML = '<tr><th>Km</th><th>Station</th><th>Niveau</th><th>Écart</th></tr>' +
    shown.map(s => `<tr onclick="viewStation('${s.id}')" style="cursor:pointer"><td>${fmt(s.km)}</td><td>${esc(s.name)}</td>
      <td><span class="dot" style="background:${LEVEL[s.level].color}"></span>${LEVEL[s.level].label}${s.unsure ? ' <span title="Diesel non confirmé">(diesel ?)</span>' : ''}</td><td>${s.off.toFixed(1).replace('.', ',')} km</td></tr>`).join('');
}
$('stMax').onchange = renderStations;
$('maxKmDay').onchange = e => {
  const v = parseInt(e.target.value, 10);
  settings.maxKmDay = v >= 100 && v <= 1200 ? v : 400;
  saveSettings();
  renderLines();
};
$('lPer100').onchange = e => {
  const v = parseFloat(e.target.value);
  settings.lPer100 = v >= 10 && v <= 60 ? v : FUEL.lPer100;
  saveSettings();
  renderLines();   // pleins, litres et coûts recalculés
};

// ---------- Journal de voyage : notes par étape, dans l'ordre du voyage ----------
function renderJournal() {
  const items = trip.steps.map((s, i) => ({ s, i })).filter(x => x.s.extra?.journal);
  $('journalList').innerHTML = items.length ? items.map(({ s, i }) => `<div class="jr">
      <div><b onclick="focusStep(${i})">${esc(s.name)}</b> <small class="src">${shortDate(arrival(i))}${isNight(s) ? ` · ${s.nights} nuit${s.nights > 1 ? 's' : ''}` : ''}</small></div>
      <div>${esc(s.extra.journal).replace(/\n/g, '<br>')}</div></div>`).join('')
    : '<div class="src">Aucune note pour l’instant : ouvrez la fiche d’une étape sur la carte, section 📔 Journal.</div>';
  $('journalCount').textContent = items.length ? `(${items.length})` : '';
}
$('journalExport').onclick = () => {
  const items = trip.steps.map((s, i) => ({ s, i })).filter(x => x.s.extra?.journal);
  const txt = 'Journal de voyage – Cap Ouest\n\n'
    + items.map(({ s, i }) => `${toIso(arrival(i))} – ${s.name}\n${s.extra.journal}\n`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
  a.download = `cap-ouest-journal-${toIso(new Date())}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- Budget : nuitées, diesel, traversiers (prévu / payé) ----------
function renderBudget(litres) {
  const steps = trip.steps;
  const nightPlan = steps.reduce((t, s) => t + (isNight(s) ? s.nights * (s.extra?.price ?? (s.type === 'c' ? settings.campRate : 0)) : 0), 0);
  const nightPaid = steps.reduce((t, s) => t + (s.extra?.paid || 0), 0);
  const ferries = steps.filter(s => s.extra?.ferry);
  const ferryPlan = ferries.reduce((t, s) => t + (s.extra.ferryCost ?? settings.ferryRate), 0);
  const ferryPaid = ferries.reduce((t, s) => t + (s.extra.ferryPaid || 0), 0);
  const fuelPlan = litres * priceL(), fuelPaid = fstats.totalCost;
  const nights = steps.reduce((t, s) => t + s.nights, 0) || 1;
  const priced = steps.filter(s => s.type === 'c' && s.extra?.price != null).length, camps = steps.filter(s => s.type === 'c').length;
  const row = (label, plan, paid, note = '') => `<tr><td>${label}${note ? ` <small class="src">${note}</small>` : ''}</td><td class="num">${fmt(plan)} $</td><td class="num">${paid ? fmt(paid) + ' $' : '—'}</td></tr>`;
  const plan = nightPlan + fuelPlan + ferryPlan, paid = nightPaid + fuelPaid + ferryPaid;
  $('budgetTable').innerHTML = '<tr><th></th><th class="num">Prévu</th><th class="num">Payé à ce jour</th></tr>'
    + row('🏕 Nuitées', nightPlan, nightPaid, `${priced}/${camps} campings avec leur prix`)
    + row('⛽ Diesel', fuelPlan, fuelPaid, `${fmt(litres)} L × ${priceL().toFixed(2).replace('.', ',')} $`)
    + row('⛴ Traversiers', ferryPlan, ferryPaid, `${ferries.length} traversée${ferries.length > 1 ? 's' : ''}`)
    + `<tr class="total"><td><b>Total</b> <small class="src">${fmt(plan / nights)} $ par jour en moyenne</small></td><td class="num"><b>${fmt(plan)} $</b></td><td class="num"><b>${paid ? fmt(paid) + ' $' : '—'}</b></td></tr>`;
  if (document.activeElement !== $('campRate')) $('campRate').value = settings.campRate;
  if (document.activeElement !== $('ferryRate')) $('ferryRate').value = settings.ferryRate;
}
$('campRate').onchange = e => { const v = parseFloat(e.target.value); settings.campRate = v >= 0 ? v : 60; saveSettings(); renderKpis(); };
$('ferryRate').onchange = e => { const v = parseFloat(e.target.value); settings.ferryRate = v >= 0 ? v : 450; saveSettings(); renderKpis(); };

// ---------- Journal des pleins réels ----------
const GAL = 3.785411784;   // litres par gallon US
// Dernier plein complet, situé sur le trajet (km depuis le départ) : point de départ des pleins prévus
function lastFullOnRoute() {
  const f = fstats.lastFull;
  if (!f || f.lat == null || !legs.length) return null;
  let best = { off: Infinity }, before = 0;
  legs.forEach(leg => {
    const pr = project(f, leg.coords);
    if (pr.off < best.off) best = { off: pr.off, km: before + pr.along * (leg.km / (pr.total || 1)) };
    before += leg.km;
  });
  return best.off <= 25 ? { km: best.km, fill: f } : null;
}

function renderFuelLog() {
  const st = fstats, fills = st.fills;
  $('fuelAuto').checked = useReal();
  $('fuelAutoTxt').textContent = st.lPer100
    ? `Utiliser ma consommation réelle : ${String(Math.round(st.lPer100 * 10) / 10).replace('.', ',')} L/100 km, mesurée sur ${fmt(st.measuredKm)} km, et mon prix moyen (${st.priceL.toFixed(3).replace('.', ',')} $ CA/L)`
    : 'Utiliser ma consommation et mon prix réels (il faut au moins deux pleins complets avec l’odomètre)';
  const next = st.lastFull ? st.lastFull.odo + fuelKm() : 0;
  $('fillStats').innerHTML = fills.length ? `<div class="kpis">
      <div class="kpi"><b>${st.lPer100 ? String(Math.round(st.lPer100 * 10) / 10).replace('.', ',') : '—'}</b><span>L/100 km réels</span></div>
      <div class="kpi"><b>${fmt(st.totalL)} L</b><span>${fills.length} plein${fills.length > 1 ? 's' : ''}</span></div>
      <div class="kpi"><b>${fmt(st.totalCost)} $</b><span>payé (en $ CA)</span></div>
      <div class="kpi"><b>${st.priceL ? st.priceL.toFixed(3).replace('.', ',') : '—'}</b><span>$ CA / L en moyenne</span></div>
    </div>${next ? `<div class="src">Prochain plein conseillé (réservoir à 50 %) vers l'odomètre <b>${fmt(next)} km</b>.</div>` : ''}` : '<div class="src">Aucun plein saisi pour l’instant.</div>';
  $('fillTable').innerHTML = fills.length ? '<tr><th>Date</th><th>Lieu</th><th>Odomètre</th><th>Litres</th><th>$ CA</th><th>$/L</th><th>L/100</th><th></th></tr>' +
    [...fills].reverse().map(f => {
      const c = st.spans.get(f.id);
      return `<tr><td>${esc(f.at.slice(0, 10))}</td><td>${esc(f.place || '')}${f.full ? '' : ' <small>(partiel)</small>'}</td><td>${fmt(f.odo)}</td>
        <td>${String(Math.round(f.litres * 10) / 10).replace('.', ',')}${f.unit === 'gal' ? ` <small>(${String(f.qty).replace('.', ',')} gal)</small>` : ''}</td>
        <td>${f.cost.toFixed(2).replace('.', ',')}${f.cur === 'USD' ? ` <small>(${f.amt.toFixed(2).replace('.', ',')} $ US)</small>` : ''}</td>
        <td>${(f.cost / f.litres).toFixed(3).replace('.', ',')}</td><td>${c ? String(Math.round(c * 10) / 10).replace('.', ',') : ''}</td>
        <td><button class="btn sm" onclick="delFillUi('${f.id}')" title="Supprimer">🗑</button></td></tr>`;
    }).join('') : '';
}

let fPos = null;
const resetFillForm = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('fDate').value = d.toISOString().slice(0, 16);
  ['fOdo', 'fQty', 'fAmt', 'fPlace'].forEach(id => { $(id).value = ''; });
  $('fFull').checked = true; fPos = null; $('fGpsTxt').textContent = '';
};
$('fCur').onchange = () => { $('fRateBox').hidden = $('fCur').value !== 'USD'; };
$('fRate').value = settings.usdCad || 1.38;
$('fRate').onchange = () => { const v = parseFloat($('fRate').value); if (v > 0.5 && v < 3) { settings.usdCad = v; saveSettings(); } };
$('fGps').onclick = () => {
  $('fGpsTxt').textContent = 'Recherche…';
  navigator.geolocation.getCurrentPosition(p => {
    fPos = { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) };
    // Lieu proposé : étape la plus proche
    const near = trip.steps.map(s => ({ s, d: hav(s, fPos) })).sort((a, b) => a.d - b.d)[0];
    if (!$('fPlace').value && near) $('fPlace').value = near.d < 40 ? `près de ${near.s.name.split(',')[0]}` : '';
    $('fGpsTxt').textContent = `✔ position prise (précision ${Math.round(p.coords.accuracy)} m)`;
  }, e => { $('fGpsTxt').textContent = '✖ ' + e.message; }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 });
};
$('fSave').onclick = () => {
  const odo = parseInt($('fOdo').value, 10), qty = parseFloat($('fQty').value), amt = parseFloat($('fAmt').value);
  const unit = $('fUnit').value, cur = $('fCur').value, rate = parseFloat($('fRate').value) || 1.38;
  if (!(odo > 0) || !(qty > 0) || !(amt > 0)) { $('fMsg').textContent = '✖ Odomètre, quantité et montant sont requis.'; return; }
  const litres = unit === 'gal' ? qty * GAL : qty;
  if (litres > 400) { $('fMsg').textContent = '✖ Quantité trop grande : vérifiez l’unité (litres ou gallons).'; return; }
  const prev = getFills().filter(f => f.odo < odo).pop();
  addFill({ at: $('fDate').value || new Date().toISOString().slice(0, 16), odo, qty, unit, litres: Math.round(litres * 100) / 100,
    amt, cur, cost: Math.round((cur === 'USD' ? amt * rate : amt) * 100) / 100, full: $('fFull').checked,
    place: $('fPlace').value.trim().slice(0, 80), ...(fPos || {}) });
  $('fMsg').textContent = `✔ Plein enregistré${prev ? ` (${fmt(odo - prev.odo)} km depuis le précédent)` : ''}.`;
  resetFillForm();
};
window.delFillUi = id => { if (confirm('Supprimer ce plein ?')) delFill(id); };
$('fuelAuto').onchange = e => { settings.fuelAuto = e.target.checked; saveSettings(); renderLines(); renderFuelLog(); };
onFuelChange(() => { fstats = fuelStats(); renderFuelLog(); renderLines(); syncNow(); });
resetFillForm();
renderFuelLog();

// Centre la carte sur la station, en vue satellite, pour juger l'entrée et la sortie
// On retient la vue d'avant (fond de carte, position, zoom) pour le bouton « Retour »
let viewBefore = null;
window.viewStation = id => {
  const s = stations.find(x => x.id === id);
  if (!s) return;
  openView('map');
  if (!viewBefore) viewBefore = { base: settings.baseMap, center: map.getCenter(), zoom: map.getZoom() };
  if (!map.hasLayer(layers.stations)) { layers.stations.addTo(map); document.querySelector('[data-lyr=stations]').checked = true; }
  if (settings.baseMap !== 'sat') document.querySelector('[name=base][value=sat]').click();
  showBack();
  map.flyTo([s.lat, s.lng], 18, { duration: .8 });
  setTimeout(() => layers.stations.eachLayer(m => { if (m.getLatLng().equals([s.lat, s.lng])) m.openPopup(); }), 900);
};

// Le bouton « Retour » est visible après une station, et chaque fois que la carte est en satellite
// (même si on y est passé par le menu Calques)
function showBack() { $('backView').hidden = !(viewBefore || settings.baseMap === 'sat'); }

function backFromStation() {
  map.closePopup();
  if (viewBefore) {
    const v = viewBefore;
    viewBefore = null;
    if (settings.baseMap !== v.base) document.querySelector(`[name=base][value=${v.base}]`).click();
    map.flyTo(v.center, v.zoom, { duration: .8 });
  } else if (settings.baseMap === 'sat') {
    document.querySelector('[name=base][value=plan]').click();
  }
  showBack();
}
$('backView').onclick = backFromStation;
document.addEventListener('keydown', e => { if (e.key === 'Escape') backFromStation(); });

// ---------- Liste d'étapes ----------
function renderList() {
  let html = '', n = 0;
  trip.steps.forEach((s, i) => {
    if (i > 0) {
      const leg = legs[i - 1];
      const long = tooLong(leg, s);
      const tag = leg.pending ? ' · ⏳' : leg.provider === 'estimate' ? ' · ≈ estimé'
        : leg.provider === 'ors-car' ? ' · 🚗 profil auto (fermé aux camions)' : '';
      html += leg.provider === 'ferry'
        ? `<div class="leg">↓ ⛴ traversier · ~${fmtH(leg.h)}</div>`
        : `<div class="leg ${long ? 'long' : ''}">↓ ${fmt(leg.km)} km${leg.h ? ' · ' + fmtH(leg.h) : ''}${tag}${long ? ` · plus de ${fmt(maxKm())} km` : leg.km > maxKm() && s.extra?.longOk ? ' · long accepté ✔' : ''}</div>`;
    }
    if (isNight(s)) n++;
    const dateInput = `<input type="date" class="dt" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)" title="${s.type === 'start' ? 'Date de départ' : 'Date d\'arrivée'}">`;
    const nightsInput = isNight(s) ? ` · <input type="number" class="nt" min="1" max="30" value="${s.nights}" onchange="act('setNights', ${i}, +this.value)" title="Nuits"> nuit${s.nights > 1 ? 's' : ''}` : '';
    html += `<div class="step">
      <span class="n ${s.type}">${s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n}</span>
      <div class="d"><b onclick="focusStep(${i})">${esc(s.name)}</b>
        <small>${s.type === 'start' ? 'Départ ' : s.type === 'dest' ? 'Arrivée ' : ''}${dateInput}${nightsInput}</small>
        <small class="gps">GPS <input value="${gpsText(s)}" title="${esc(GPS_HELP)}" onchange="act('gps', ${i}, this.value)"></small>
        ${milestoneHtml(i)}${s.extra?.note ? `<small>ℹ ${esc(s.extra.note)}</small>` : ''}${s.extra?.addr ? `<small>📍 <a href="${goUrl(s)}" target="_blank" rel="noopener">${esc(s.extra.addr)}</a></small>` : ''}${s.extra?.alts?.length ? `<small>🔁 Rechange : ${s.extra.alts.map(a => esc(a.name)).join(' · ')}</small>` : ''}</div>
      ${isNight(s) ? `<div class="ctl"><button onclick="act('up', ${i})" title="Monter">↑</button><button onclick="act('down', ${i})" title="Descendre">↓</button></div>` : ''}
    </div>`;
  });
  $('stepList').innerHTML = html;
  $('phase2Box').hidden = trip.steps.some(s => /calgary/i.test(s.name));
}

// Ajoute la suite proposée (data.js PHASE2) après la destination actuelle (Yellowstone),
// puis ajuste le séjour à Yellowstone pour arriver à Calgary pendant le Stampede (vers le 12 juillet).
$('addPhase2').onclick = () => {
  const steps = trip.steps, last = steps[steps.length - 1];
  // Une seule fois : la suite contient Calgary
  if (steps.some(s => /calgary/i.test(s.name))) { $('phase2Box').hidden = true; return; }
  if (last.type === 'dest') {
    const by = stepBy(last);
    last.extra = { ...(last.extra || {}), ...(by ? { by, label: last.extra?.label || 'Arrivée visée' } : {}) };
    last.type = 'c';
    last.nights = Math.max(last.nights, 3);
    last.leaveRig ??= true;
  }
  PHASE2.forEach(p => steps.push(newStep(structuredClone(p))));
  const ci = steps.findIndex(s => s.extra?.from);
  const gap = dayDiff(arrival(ci), parseIso('2027-07-12'));
  last.nights = Math.min(7, Math.max(1, last.nights + gap));   // au plus une semaine à Yellowstone
  refresh(true);
  fitRoute();
};

// ---------- Calendrier ----------
function renderCalendar() {
  const days = $('days');
  days.innerHTML = '';
  let k = 0;
  trip.steps.forEach((s, i) => {
    for (let j = 0; j < s.nights; j++, k++) {
      const d = addDays(parseIso(trip.startIso), k);
      const el = document.createElement('div');
      el.className = 'd-' + s.type;
      el.textContent = d.getDate() === 1 ? `${d.getDate()}/${d.getMonth() + 1}` : d.getDate();
      el.title = `${d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })} · ${s.name}`;
      el.onclick = () => focusStep(i);
      days.appendChild(el);
    }
  });
  const arrive = addDays(parseIso(trip.startIso), k);
  const el = document.createElement('div');
  el.className = 'd-dest';
  el.textContent = `${arrive.getDate()}/${arrive.getMonth() + 1}`;
  el.title = `Arrivée : ${trip.steps[trip.steps.length - 1].name}`;
  el.onclick = () => focusStep(trip.steps.length - 1);
  days.appendChild(el);
  days.style.gridTemplateColumns = `repeat(${k + 1}, minmax(22px, 1fr))`;

  const ms = milestones();
  const m = $('margin');
  m.textContent = ms.length ? ms.map(x => `${x.ok ? '✔' : '⚠'} ${x.short}`).join(' · ') : `Fin ${shortDate(arrive)}`;
  m.title = ms.map(x => `${x.s.name} : ${x.msg}`).join(' / ');
  m.className = 'chip ' + (ms.every(x => x.ok) ? 'c' : 'x');
}

// ---------- Jalons de dates (arriver au plus tard / pas avant) ----------
// Compatibilité : une étape Yellowstone sans jalon garde la cible du 1er juillet
const stepBy = s => s.extra?.by ?? (/yellowstone/i.test(s.name) && !s.extra ? YELLOWSTONE_BY : null);
function milestones() {
  return trip.steps.map((s, i) => {
    const by = stepBy(s), from = s.extra?.from;
    if (!by && !from) return null;
    const d = arrival(i), place = s.name.split(/[,(–]/)[0].trim();
    const late = by ? dayDiff(parseIso(by), d) : 0, early = from ? dayDiff(d, parseIso(from)) : 0;
    const nightsOff = s.extra?.reserved && s.nights !== s.extra.resNights;
    const ok = late <= 0 && early <= 0 && !nightsOff;
    const msg = (nightsOff ? `${s.nights} nuit(s) prévue(s) au lieu de ${s.extra.resNights} réservée(s) · ` : '') + (late > 0 ? `en retard de ${late} j (au plus tard le ${shortDate(parseIso(by))})`
      : early > 0 ? `trop tôt de ${early} j (pas avant le ${shortDate(parseIso(from))})`
      : by ? `arrivée ${shortDate(d)}${s.extra?.reserved ? '' : `, marge ${-late} j`}` : `arrivée ${shortDate(d)}`);
    const state = ok ? (s.extra?.reserved ? ' (réservé)' : by ? ` (marge ${-late} j)` : '')
      : late > 0 ? ` : retard ${late} j` : early > 0 ? ` : tôt ${early} j` : ' : nuits ≠ réservation';
    return { i, s, ok, msg, short: `${place} ${shortDate(d)}${state}` };
  }).filter(Boolean);
}
function milestoneHtml(i) {
  const x = milestones().find(m => m.i === i);
  if (!x) return '';
  const r = x.s.extra?.reserved && x.ok ? ` · ${x.s.extra.resNights} nuit(s) réservée(s)` : '';
  const what = x.s.extra?.reserved ? `Réservé${x.s.extra.resName ? ' – ' + esc(x.s.extra.resName) : ''}` : esc(x.s.extra?.label || 'Jalon');
  return `<small style="color:${x.ok ? 'var(--ok)' : 'var(--bad)'}">📌 ${what} : ${x.msg}${r}</small>`;
}

// ---------- Compteurs de séjour (États-Unis, hors Québec) ----------
const longDate = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
function renderDays() {
  const days = dayLog(trip.steps, trip.startIso);
  const periods = usPeriods(days);
  const planned = periods.reduce((t, p) => t + p.days, 0);
  const max = usRollingMax(days);
  $('dUsPlanned').textContent = `${planned} j`;
  $('dUsMax').textContent = `${max} / ${US_LIMIT} j`;
  $('dUsMax').style.color = max > US_LIMIT ? 'var(--bad)' : '';
  $('dUsPeriods').textContent = periods.length
    ? 'Périodes : ' + periods.map(p => `${shortDate(p.from)} → ${shortDate(p.to)} (${p.days} j)`).join(' · ')
    : 'Aucun jour aux États-Unis dans le trajet planifié.';
  $('hudDays').textContent = `🇺🇸 ${max}/${US_LIMIT} j`;
  $('hudDays').className = 'chip ' + (max > US_LIMIT ? 'x' : '');

  // Calculateur : date d'entrée de l'automne → dernier jour possible aux États-Unis
  const entryIso = settings.usEntry || `${parseIso(trip.startIso).getFullYear()}-09-15`;
  $('dUsEntry').value = entryIso;
  const ex = latestUsExit(days, entryIso);
  $('dUsExit').textContent = ex ? longDate(ex.last) : '—';
  $('dUsExitNote').textContent = ex
    ? `Soit ${ex.stay} jours de séjour continu${ex.before ? `, en tenant compte de ${ex.before} jours déjà passés aux États-Unis dans les 12 mois précédents` : ''}.`
    : '';

  // RAMQ : année civile du départ
  const year = parseIso(trip.startIso).getFullYear();
  const qc = qcAbsence(days, year);
  // Une ligne par année civile couverte par le trajet (ex. 2027 et 2028)
  const years = [...new Set(days.map(d => d.date.getFullYear()))];
  $('dQcYearLbl').textContent = 'Prévus au trajet';
  $('dQcPlanned').textContent = years.map(y => `${y} : ${qcAbsence(days, y).planned} j`).join(' · ');
  $('dQcProjected').textContent = qc.stillAway ? `${qc.projected} j` : '—';
  const over = Math.max(qc.planned, qc.projected) >= QC_LIMIT;
  const sept = !!settings.septennial;
  $('dQcSept').checked = sept;
  $('dQcSeptYear').textContent = year;
  $('dQcProjected').style.color = over && !sept ? 'var(--bad)' : over ? 'var(--ok)' : '';
  // L'année septennale ne couvre qu'une année civile : l'année suivante, la règle des 183 jours
  // s'applique de nouveau. Absent dès le 1er janvier, il faut être revenu au plus tard le 182e jour.
  $('dQcNext').textContent = shortDate(addDays(new Date(year + 1, 0, 1), QC_LIMIT - 1)) + ` ${year + 1}`;
  $('dQcNote').textContent = !over
    ? `Moins de ${QC_LIMIT} jours d'absence en ${year} selon le trajet planifié.`
    : sept
      ? `Année septennale ${year} : l'absence de 183 jours ou plus est permise cette année-là, à condition d'en avoir avisé la RAMQ avant le départ. En ${year + 1}, la règle des 183 jours revient : être de retour au Québec au plus tard vers la date indiquée ci-dessus.`
      : `Au-delà de ${QC_LIMIT - 1} jours d'absence en ${year} : l'admissibilité à la RAMQ serait perdue pour toute l'année, sauf année septennale (une fois tous les 7 ans, sur avis à la RAMQ avant le départ).`;
}
$('dQcSept').onchange = e => { settings.septennial = e.target.checked; saveSettings(); renderDays(); };
$('dUsEntry').onchange = e => { settings.usEntry = e.target.value; saveSettings(); renderDays(); };

// ---------- Rattrapage d'un retard (propositions, aperçu, application) ----------
const cuChosen = new Set();
let cuFromId = null;

// Dates des jalons pour une liste d'étapes quelconque (aperçu sans toucher au voyage)
function milestoneDates(steps) {
  const out = new Map();
  let d = parseIso(trip.startIso);
  steps.forEach(s => {
    const by = stepBy(s), from = s.extra?.from;
    if (by || from) {
      const late = by ? dayDiff(parseIso(by), d) : 0, early = from ? dayDiff(d, parseIso(from)) : 0;
      out.set(s.id, { name: s.name.split(/[,(–]/)[0].trim(), date: d, ok: late <= 0 && early <= 0, late, early });
    }
    d = addDays(d, s.nights);
  });
  return out;
}
const msCell = m => !m ? '—'
  : `<span style="color:${m.ok ? 'var(--ok)' : 'var(--bad)'}">${shortDate(m.date)}${m.late > 0 ? ` · retard ${m.late} j` : m.early > 0 ? ` · ${m.early} j trop tôt` : ' ✔'}</span>`;

function renderCatchup() {
  const steps = trip.steps;
  if (!cuFromId || !steps.some(s => s.id === cuFromId)) cuFromId = steps[0].id;
  $('cuFrom').innerHTML = steps.slice(0, -1).map(s =>
    `<option value="${s.id}" ${s.id === cuFromId ? 'selected' : ''}>${shortDate(arrival(steps.indexOf(s)))} · ${esc(s.name)}</option>`).join('');
  if (!$('cuKm').value) $('cuKm').value = maxKm() + 100;
  const from = steps.findIndex(s => s.id === cuFromId);
  const delay = Math.max(0, parseInt($('cuDelay').value, 10) || 0);
  const km = parseInt($('cuKm').value, 10) || maxKm();

  const props = proposals(steps, legs, from, km);
  [...cuChosen].forEach(id => { if (!props.some(p => p.id === id)) cuChosen.delete(id); });
  $('cuList').innerHTML = props.length
    ? props.map(p => `<label class="field" style="justify-content:flex-start"><input type="checkbox" data-cu="${p.id}" ${cuChosen.has(p.id) ? 'checked' : ''}>
        <span>${p.kind === 'skip' ? '🚚' : '🏕'} ${esc(p.label)}</span><i style="margin-left:auto">−1 j</i></label>`).join('')
    : '<div class="src">Aucune coupure possible après cette étape à ce rythme. Augmentez les km par jour.</div>';
  $('cuList').querySelectorAll('[data-cu]').forEach(cb => cb.onchange = () => {
    cb.checked ? cuChosen.add(cb.dataset.cu) : cuChosen.delete(cb.dataset.cu);
    renderCatchup();
  });

  const chosen = props.filter(p => cuChosen.has(p.id));
  const saved = chosen.reduce((t, p) => t + p.saves, 0);
  $('cuSummary').textContent = `${saved} jour(s) rattrapé(s)${delay ? ` sur ${delay} de retard` : ''}`;
  $('cuSummary').style.color = delay && saved >= delay ? 'var(--ok)' : '';

  // Aperçu : jalons et jours aux États-Unis, avant et après les coupures choisies
  const late = simulate(steps, from, delay, []);
  const after = simulate(steps, from, delay, chosen);
  const a = milestoneDates(late), b = milestoneDates(after);
  const usA = usRollingMax(dayLog(late, trip.startIso)), usB = usRollingMax(dayLog(after, trip.startIso));
  $('cuImpact').innerHTML = '<tr><th>Jalon</th><th>Avec le retard</th><th>Avec les coupures</th></tr>' +
    [...a.keys()].map(id => `<tr><td>${esc(a.get(id).name)}</td><td>${msCell(a.get(id))}</td><td>${msCell(b.get(id))}</td></tr>`).join('') +
    `<tr><td>🇺🇸 Jours aux USA (12 mois)</td><td>${usA} / ${US_LIMIT}</td><td style="color:${usB > US_LIMIT ? 'var(--bad)' : ''}">${usB} / ${US_LIMIT}</td></tr>`;
  $('cuApply').disabled = !delay && !chosen.length;
  try { $('cuUndo').hidden = !localStorage.getItem('capouest.trip.precatchup'); } catch {}
}
$('cuFrom').onchange = e => { cuFromId = e.target.value; renderCatchup(); };
$('cuDelay').oninput = renderCatchup;
$('cuKm').oninput = renderCatchup;

$('cuApply').onclick = () => {
  const from = trip.steps.findIndex(s => s.id === cuFromId);
  const delay = Math.max(0, parseInt($('cuDelay').value, 10) || 0);
  const chosen = proposals(trip.steps, legs, from, parseInt($('cuKm').value, 10) || maxKm()).filter(p => cuChosen.has(p.id));
  if (!confirm(`Appliquer ${delay ? delay + ' jour(s) de retard et ' : ''}${chosen.length} coupure(s) au voyage ?`)) return;
  try { localStorage.setItem('capouest.trip.precatchup', JSON.stringify(trip.steps)); } catch {}
  trip.steps = simulate(trip.steps, from, delay, chosen);
  cuChosen.clear();
  $('cuDelay').value = 0;
  refresh(true);
  $('cuMsg').textContent = '✔ Rattrapage appliqué. « Annuler le dernier rattrapage » remet le voyage comme avant.';
};
$('cuUndo').onclick = () => {
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem('capouest.trip.precatchup')); } catch {}
  if (!prev || !confirm('Remettre le voyage comme avant le dernier rattrapage ?')) return;
  trip.steps = prev;
  try { localStorage.removeItem('capouest.trip.precatchup'); } catch {}
  refresh(true);
  $('cuMsg').textContent = '✔ Voyage remis comme avant le rattrapage.';
};

// ---------- Indicateurs ----------
// En-tête : départ → destination · mois de départ → mois d'arrivée (durée), tiré du voyage lui-même
function renderTripTitle() {
  const st = trip.steps, city = s => s.name.split(/[,(–]/)[0].trim();
  const a = arrival(0), b = arrival(st.length - 1);
  const mo = d => d.toLocaleDateString('fr-CA', { month: 'short', year: 'numeric' });
  const months = Math.max(1, Math.round((b - a) / 864e5 / 30.4));
  $('tripTitle').textContent = `${city(st[0])} → ${city(st[st.length - 1])} · ${mo(a)} → ${mo(b)} (${months} mois)`;
}

// Tableau de bord : tout de suite s'il est ouvert, sinon un peu plus tard (la fiche d'étape s'affiche
// d'abord ; plusieurs clics de suite = un seul calcul)
let kpisTimer = 0;
function queueKpis() {
  clearTimeout(kpisTimer);
  if (drawer.classList.contains('open') && $('dash').classList.contains('on')) renderKpis();
  else kpisTimer = setTimeout(renderKpis, 400);
}

function renderKpis() {
  const km = legs.reduce((t, l) => t + l.km, 0);
  const hours = legs.reduce((t, l) => t + (l.h || 0), 0);
  const nights = trip.steps.reduce((t, s) => t + s.nights, 0);
  const nb = trip.steps.filter(s => s.type === 'b').reduce((t, s) => t + s.nights, 0);
  const litres = km * lPer100() / 100;
  const set = (id, v) => { $(id).textContent = v; };
  set('kKm', fmt(km));
  set('kHours', legs.every(l => l.h) ? fmtH(hours) : '—');
  set('kDays', nights);
  set('kAvg', fmt(km / Math.max(1, legs.length)));
  set('kL', fmt(litres) + ' L');
  set('kCost', fmt(litres * priceL()) + ' $');
  set('kSpent', fstats.totalCost ? fmt(fstats.totalCost) + ' $' : '—');
  renderBudget(litres);
  renderJournal();
  const nc = trip.steps.filter(s => s.type === 'c').reduce((t, s) => t + s.nights, 0);
  const pct = n => nb + nc ? ` (${Math.round(n / (nb + nc) * 100)} %)` : '';
  set('kNightsB', nb + pct(nb));
  set('kNightsC', nc + pct(nc));
  set('kFuel', fuelPts.length);
  $('fuelRange').textContent = `~${fmt(fuelKm())} km`;
  $('routeMaxTxt').textContent = `${fmt(maxKm())} km`;
  if (document.activeElement !== $('maxKmDay')) $('maxKmDay').value = maxKm();
  if (document.activeElement !== $('lPer100')) $('lPer100').value = lPer100();
  $('lPer100').disabled = useReal() && !!fstats.lPer100;
  renderDays();
  renderCatchup();
  const p = providerOf(routeOpts());
  $('dashNote').textContent = `Distances : ${PROVIDER_LABEL[p]}. Consommation ${String(lPer100()).replace('.', ',')} L/100 km et prix ${priceL().toFixed(2).replace('.', ',')} $ CA/L ${useReal() && fstats.priceL ? '(moyenne de vos pleins)' : 'provisoires'}. Tous les montants en $ CA.`;
}

function renderFuelTable() {
  const cost = FUEL.tankL * FUEL.threshold * priceL();
  $('fuelTable').innerHTML = '<tr><th>#</th><th>Km</th><th>Secteur</th><th>Plein</th><th>Coût ~</th></tr>' +
    fuelPts.map((p, k) => {
      const a = trip.steps[p.leg], b = trip.steps[p.leg + 1];
      return `<tr><td>${k + 1}</td><td>${fmt(p.km)}</td><td>${esc(a.name.split(',')[0])} → ${esc(b.name.split(',')[0])}</td><td>~${fmt(FUEL.tankL * FUEL.threshold)} L</td><td>${fmt(cost)} $</td></tr>`;
    }).join('');
}

// ---------- Actions sur les étapes ----------
function refresh(geometry) {
  saveTrip();
  renderMarkers();
  if (geometry) recompute(); else renderLines();
}

window.act = (what, i, v) => {
  const steps = trip.steps, s = steps[i];
  const hadPopup = !!map.getContainer().querySelector('.leaflet-popup');
  let geometry = false;
  if (what === 'rename') { s.name = v; saveTrip(); renderList(); return; }
  if (what === 'nuit') { openView('nuit'); return; }
  if (what === 'nights') s.nights = Math.max(1, s.nights + v);
  if (what === 'setNights') s.nights = Math.max(1, Math.min(30, v || 1));
  if (what === 'type') s.type = s.type === 'b' ? 'c' : 'b';
  if (what === 'leaveRig') s.leaveRig = v;
  if (what === 'longOk') s.extra = { ...(s.extra || {}), longOk: v };
  // Réservation : la date d'arrivée actuelle devient fixe (arriver ni avant ni après)
  if (what === 'reserve') {
    const { reserved, resName, resNights, ...rest } = s.extra || {};
    const iso = toIso(arrival(i));
    if (v) s.extra = { ...rest, reserved: true, resName: resName || '', resNights: s.nights, from: iso, by: iso, label: 'Réservé' };
    else {
      const { from, by, label, ...others } = rest;   // retirer aussi la date fixe posée par la réservation
      s.extra = label === 'Réservé' ? others : rest;
    }
  }
  if (what === 'resName') s.extra = { ...(s.extra || {}), resName: v };
  if (what === 'addr') s.extra = { ...(s.extra || {}), addr: v.trim() };
  if (what === 'altAdd') {
    const [name, where] = v.map(x => (x || '').trim());
    if (!name && !where) return;
    const p = parseGps(where);
    const a = { name: name || (p ? 'Choix de rechange' : where), ...(p || {}), ...(!p && where && name ? { addr: where } : {}) };
    s.extra = { ...(s.extra || {}), alts: [...(s.extra?.alts || []), a] };
  }
  if (what === 'altDel') {
    const alts = (s.extra?.alts || []).filter((_, k) => k !== v);
    const { alts: _, ...rest } = s.extra || {};
    s.extra = alts.length ? { ...rest, alts } : rest;
  }
  // L'endroit de rechange devient l'endroit prévu ; l'endroit prévu passe en tête des rechanges
  if (what === 'altUse') {
    const alts = [...(s.extra?.alts || [])], a = alts.splice(v, 1)[0];
    if (!a) return;
    const old = { name: s.name, lat: s.lat, lng: s.lng, ...(s.extra?.addr ? { addr: s.extra.addr } : {}) };
    const { addr, ...rest } = s.extra || {};
    s.name = a.name;
    if (a.lat != null) { s.lat = a.lat; s.lng = a.lng; geometry = true; }
    s.extra = { ...rest, ...(a.addr ? { addr: a.addr } : {}), alts: [old, ...alts] };
  }
  if (what === 'gps') {
    const p = parseGps(v);
    if (!p) { alert('Position GPS non reconnue.\n' + GPS_HELP); renderList(); markers.get(s.id)?.openPopup(); return; }
    s.lat = p.lat; s.lng = p.lng; geometry = true;
    map.panTo([p.lat, p.lng]);
  }
  if (what === 'journal') {
    const { journal, ...rest } = s.extra || {};
    s.extra = v.trim() ? { ...rest, journal: v.trim().slice(0, 4000), journalAt: toIso(new Date()) } : rest;
  }
  // Budget : prix prévu par nuit, montant payé, traversier prévu / payé (vide = retiré)
  if (what === 'money') {
    const [k, raw] = v, n = parseFloat(raw);
    const { [k]: _, ...rest } = s.extra || {};
    s.extra = n >= 0 ? { ...rest, [k]: Math.round(n * 100) / 100 } : rest;
  }
  if (what === 'del') { steps.splice(i, 1); map.closePopup(); geometry = true; }
  if (what === 'up' && steps[i - 1].type !== 'start') { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; geometry = true; }
  if (what === 'moveAfter' && v !== i && v !== i - 1) {
    steps.splice(i, 1);
    steps.splice(v < i ? v + 1 : v, 0, s);
    geometry = true;
  }
  if (what === 'down' && steps[i + 1].type !== 'dest') { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; geometry = true; }
  // Changer une date d'arrivée allonge ou raccourcit le séjour à l'étape précédente
  // (pour la première étape ou le départ : décale la date de départ)
  if (what === 'date' && v) {
    const delta = dayDiff(arrival(i), parseIso(v));
    const prev = steps[i - 1];
    if (i === 0 || prev.type === 'start') trip.startIso = toIso(addDays(parseIso(trip.startIso), delta));
    else if (prev.nights + delta < 1) alert(`Impossible : ${prev.name} doit garder au moins 1 nuit. Date la plus tôt : ${addDays(arrival(i - 1), 1).toLocaleDateString('fr-CA')}

Si l'étape n'est pas au bon endroit dans le voyage, choisissez « Placer après » dans sa fiche.`);
    else prev.nights += delta;
    if (s.extra?.reserved) s.extra = { ...s.extra, from: toIso(arrival(i)), by: toIso(arrival(i)) };
  }
  refresh(geometry);
  if (hadPopup && ['nights', 'type', 'date', 'leaveRig', 'longOk', 'reserve', 'resName', 'addr', 'gps', 'money', 'journal', 'altAdd', 'altDel', 'altUse', 'moveAfter'].includes(what)) markers.get(s.id)?.openPopup();
};

window.focusStep = i => {
  openView('map');
  const s = trip.steps[i];
  map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 8), { duration: .6 });
  setTimeout(() => markers.get(s.id)?.openPopup(), 650);
};

// Ajout d'étape : insérée là où elle allonge le moins le trajet
let adding = false;
function setAdding(on) {
  adding = on;
  $('map').classList.toggle('adding', on);
  $('hint').classList.toggle('on', on);
  $('addBtn').classList.toggle('on', on);
}
$('addBtn').onclick = () => { openView('map'); setAdding(!adding); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') setAdding(false); });

map.on('click', e => {
  if (!adding) { openView('map'); return; }   // clic sur la carte = rentrer le tiroir
  addStepAt({ lat: e.latlng.lat, lng: e.latlng.lng });
});
// … ou par sa position GPS saisie dans le bandeau
$('hintGo').onclick = () => {
  const p = parseGps($('hintGps').value);
  if (!p) { alert('Position GPS non reconnue.\n' + GPS_HELP); return; }
  $('hintGps').value = '';
  map.setView([p.lat, p.lng], Math.max(map.getZoom(), 9));
  addStepAt(p);
};
$('hintGps').onkeydown = e => { if (e.key === 'Enter') $('hintGo').click(); };

function addStepAt(p) {
  const steps = trip.steps;
  let best = 1, bestCost = Infinity;
  for (let i = 1; i < steps.length; i++) {
    const cost = hav(steps[i - 1], p) + hav(p, steps[i]) - hav(steps[i - 1], steps[i]);
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  const s = newStep({ name: 'Nouvelle étape', ...p, type: 'b', nights: 1 });
  steps.splice(best, 0, s);
  setAdding(false);
  refresh(true);
  markers.get(s.id).openPopup();
}

$('resetBtn').onclick = () => {
  if (!confirm('Revenir à l\'itinéraire par défaut ?')) return;
  resetTrip();
  renderMarkers(); recompute(); fitRoute();
};

// ---------- Mode conduite : où suis-je sur le trajet, et qu'est-ce qui vient ----------
// Lieux de « Mes guides » projetés sur chaque tronçon (calculé une fois par tronçon)
const guideCache = new WeakMap();
function guidesOnLeg(leg) {
  if (!guideCache.has(leg)) {
    const scale = leg.km / (lineKm(leg.coords) || 1);
    guideCache.set(leg, getPlaces().filter(p => p.cat !== 'camping').map(p => ({ p, pr: project(p, leg.coords) }))
      .filter(x => x.pr.off <= 10).map(x => ({ ...x.p, alongKm: x.pr.along * scale })));
  }
  return guideCache.get(leg);
}
onPlacesChange(() => legs.forEach(l => guideCache.delete(l)));

function renderDrive(pos) {
  const box = $('drive');
  if (!legs.length) { box.hidden = true; return; }
  // Tronçon le plus proche (on cherche d'abord autour du précédent, puis partout)
  let best = { off: Infinity };
  let kmBefore = 0;
  legs.forEach((leg, li) => {
    const pr = project(pos, leg.coords);
    if (pr.off < best.off) best = { off: pr.off, li, km: kmBefore + pr.along * (leg.km / (pr.total || 1)), frac: pr.along / (pr.total || 1) };
    kmBefore += leg.km;
  });
  const myKm = best.km, leg = legs[best.li];
  // De retour sur le trajet prévu : le chemin de retour n'est plus utile
  if (detour && best.off < 0.5) clearDetour();
  const next = detour ? trip.steps.find(s => s.id === detour.toId) || trip.steps[best.li + 1] : trip.steps[best.li + 1];
  let nextKm = legs.slice(0, best.li + 1).reduce((t, l) => t + l.km, 0) - myKm;
  let hours = (leg.h || leg.km / 80) * (1 - best.frac);
  if (detour) {
    // Distance restante le long du chemin de retour
    const pr = project(pos, detour.coords), left = 1 - pr.along / (pr.total || 1);
    nextKm = detour.km * left; hours = detour.h * left;
  }
  const eta = new Date(Date.now() + hours * 36e5).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

  // Prochaine station facile (sinon faisable) devant nous, et prochain plein prévu
  const ahead = stations.filter(s => s.km > myKm + 1);
  const st = ahead.find(s => s.level === 1) || ahead.find(s => s.level === 2);
  const plein = fuelPts.find(p => p.km > myKm);

  // Prochaine découverte : guides personnels (10 km du trajet) et découvertes OSM, dans les 300 km
  let poi = null, legStart = myKm - best.frac * leg.km;
  for (let li = best.li; li < legs.length && legStart < myKm + 300; li++) {
    guidesOnLeg(legs[li]).forEach(g => {
      const km = legStart + g.alongKm;
      if (km > myKm + 0.5 && (!poi || km < poi.km)) poi = { name: g.name, icon: PLACE_CATS[g.cat]?.icon || '★', km };
    });
    legStart += legs[li].km;
  }
  const osm = pois.find(p => p.km > myKm + 0.5 && p.mode !== 'check');
  if (osm && (!poi || osm.km < poi.km)) poi = { name: osm.n || CATS[osm.c]?.label, icon: CATS[osm.c]?.icon || '★', km: osm.km };

  const d = km => `${fmt(km)} km`;
  // Prochain passage bas dans les 30 km devant (sur le trajet prévu)
  const low = clearances.find(c => c.km > myKm - 0.2 && c.km < myKm + 30);
  const tk = trailKm();
  box.innerHTML = `
    ${detour ? `<div class="back">↩ Chemin de retour vers ${esc(next.name.split(',')[0])}${detour.provider === 'osrm' || detour.provider === 'ors-car' ? ' <small>(calcul auto, sans restrictions VR)</small>' : ''}
        <button class="btn sm" onclick="clearDetour()">✕</button></div>`
      : best.off > 3 ? `<div class="warn">⚠ Hors du trajet prévu (${d(best.off)})
        <button class="btn sm" id="backBtn" onclick="backToRoute()">↩ Retour au trajet</button></div>` : ''}
    <div class="big">🏁 <b>${esc(next.name.split(',')[0])}</b><span>${d(nextKm)} · ${fmtH(hours)} · arrivée ~${eta}</span></div>
    <div>⛽ ${st ? `<b>${esc(st.name)}</b> <span style="display:inline;color:${LEVEL[st.level].color}">${LEVEL[st.level].label}</span> · ${d(st.km - myKm)}` : 'Aucune station facile connue devant'}
      ${plein ? `<small>Plein prévu (réservoir à 50 %) dans ${d(plein.km - myKm)}</small>` : ''}</div>
    ${low ? `<div class="lowc${low.danger ? ' danger' : ''}">${low.danger ? '⛔' : '⚠'} ${low.kind} : <b>${feet(low.h)}</b> dans ${d(Math.max(0, low.km - myKm))}${low.road ? ` <small>${esc(low.road)}</small>` : ''}</div>` : ''}
    <div>🧭 ${poi ? `${poi.icon} <b>${esc(poi.name)}</b> · ${d(poi.km - myKm)}` : 'Aucune découverte dans les 300 prochains km'}</div>
    <div class="src">📍 Parcouru aujourd'hui : ${d(tk.today)} · depuis le début : ${d(tk.total)}</div>`;
  box.hidden = false;
  lastPos = pos; lastNext = next;
}

// Retour au trajet : chemin (poids lourd avec la clé ORS) de la position actuelle à la prochaine étape
let detour = null, lastPos = null, lastNext = null;
window.clearDetour = () => { detour = null; layers.detour.clearLayers(); if (lastPos) renderDrive(lastPos); };
window.backToRoute = async () => {
  if (!lastPos || !lastNext) return;
  const btn = $('backBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Calcul…'; }
  try {
    const r = await routeOnce(lastPos, lastNext, routeOpts());
    detour = { ...r, toId: lastNext.id };
    layers.detour.clearLayers();
    L.polyline(r.coords, { color: '#2a7de1', weight: 6, opacity: .85 }).addTo(layers.detour);
    renderDrive(lastPos);
  } catch (e) {
    alert('Chemin de retour impossible à calculer (réseau ou clé ORS) : ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '↩ Retour au trajet'; }
  }
};

// ---------- Outils de la carte ----------
const fitRoute = () => map.fitBounds(L.latLngBounds(trip.steps.map(s => [s.lat, s.lng])), { padding: [40, 40] });
$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();
$('fit').onclick = fitRoute;
// Ma position (GPS de l'appareil) : un appui active le mode conduite (camion sur la carte, la carte suit,
// bandeau prochain plein / découverte / étape), un autre l'arrête
let following = false, firstFix = false, lastFixAt = 0;
const me = L.layerGroup().addTo(map);
const truckIcon = L.divIcon({ className: '', html: '<div class="me">🛻</div>', iconSize: [36, 36], iconAnchor: [18, 18] });
// Pas de délai maximal : Leaflet abandonne sinon après 10 s, alors que le premier point GPS
// d'une tablette (sans aide du réseau cellulaire) peut prendre plus longtemps
const startLocate = () => { map.stopLocate(); lastFixAt = Date.now(); map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 5000, timeout: Infinity }); };
// Le suivi reste actif d'une ouverture à l'autre sur cet appareil (tablette du camion) : l'appli
// s'ouvre alors directement sur la position, zoomée de près ; le portable n'est pas touché
$('locate').onclick = () => {
  following = !following;
  settings.follow = following; saveSettings();
  $('locate').classList.toggle('on', following);
  $('headUp').hidden = !following;
  $('stage').classList.toggle('driving', following);
  if (following) { firstFix = true; $('locate').textContent = '⏳'; startLocate(); }
  else { map.stopLocate(); me.clearLayers(); $('locate').textContent = '◎'; $('drive').hidden = true; detour = null; layers.detour.clearLayers(); northUp(); }
};
// Route devant (comme un GPS d'auto) : la carte tourne selon le cap du camion. Le cap vient du GPS
// quand on roule assez vite, sinon de la direction entre deux positions à plus de 25 m ; à l'arrêt,
// on garde le dernier cap. Le bouton 🧭 bascule entre route devant et nord en haut.
let heading = null, headFrom = null;
const northUp = () => { heading = null; headFrom = null; map.setBearing(0); };
const capBetween = (a, b) => {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r),
    x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};
const updateHeading = e => {
  if (!headFrom) { headFrom = e.latlng; return; }
  if (Number.isFinite(e.heading) && e.speed > 3) heading = e.heading;
  else if (map.distance(headFrom, e.latlng) > 25) heading = capBetween(headFrom, e.latlng);
  else return;
  headFrom = e.latlng;
};
const showHeadUp = () => {
  $('headUp').classList.toggle('on', settings.headUp);
  $('headUp').title = settings.headUp ? 'Route devant (toucher : nord en haut)' : 'Nord en haut (toucher : route devant)';
};
$('headUp').onclick = () => {
  settings.headUp = !settings.headUp; saveSettings(); showHeadUp();
  if (!settings.headUp) map.setBearing(0);
  else if (heading !== null) map.setBearing(-heading);
};
showHeadUp();
// Chrome (Android) coupe le GPS de la page quand l'écran s'éteint ou qu'on passe à une autre appli,
// et ne le relance pas toujours au retour : le camion restait figé. On relance le suivi au retour,
// et aussi s'il n'arrive plus aucune position depuis 30 s.
document.addEventListener('visibilitychange', () => { if (following && !document.hidden) startLocate(); });
setInterval(() => { if (following && !document.hidden && Date.now() - lastFixAt > 30000) startLocate(); }, 10000);
// Vitesse (km/h) : celle du GPS, sinon distance / temps entre deux positions ; lissée
let speedKmh = null, prevFix = null;
const updateSpeed = e => {
  let v = Number.isFinite(e.speed) && e.speed >= 0 ? e.speed * 3.6 : null;
  const t = e.timestamp || Date.now();
  if (v === null && prevFix && t - prevFix.t >= 1000) v = map.distance(prevFix.ll, e.latlng) / (t - prevFix.t) * 3600;
  if (!prevFix || t - prevFix.t >= 1000) prevFix = { ll: e.latlng, t };
  if (v !== null) speedKmh = speedKmh === null ? v : speedKmh * 0.6 + v * 0.4;
};
// Zoom selon la vitesse : de près en ville, plus loin sur l'autoroute. Changé seulement après deux
// positions de suite (pas de va-et-vient) ; en pause une minute si l'utilisateur zoome lui-même.
const zoomFor = v => v < 25 ? 16 : v < 55 ? 15 : v < 85 ? 14 : 13;
let autoZoomPause = 0, ourZoom = false, pendingZoom = null, pendingCount = 0;
map.on('zoomstart', () => { if (following && !firstFix && !ourZoom) autoZoomPause = Date.now() + 60000; });
// Vue qui suit le camion ; en mode route devant, il est placé au tiers du bas de l'écran
// (centre de la carte décalé devant lui, selon son cap) pour voir plus de route devant
const followView = e => {
  let z = map.getZoom();
  if (speedKmh !== null && Date.now() > autoZoomPause) {
    const t = zoomFor(speedKmh);
    if (t !== pendingZoom) { pendingZoom = t; pendingCount = 0; }
    if (++pendingCount >= 2) z = t;
  }
  let center = e.latlng;
  if (settings.headUp && heading !== null) {
    const lat = e.latlng.lat, r = Math.PI / 180;
    const d = map.getSize().y * 0.2 * 156543.03 * Math.cos(lat * r) / 2 ** z;   // mètres
    center = L.latLng(lat + d * Math.cos(heading * r) / 111320, e.latlng.lng + d * Math.sin(heading * r) / (111320 * Math.cos(lat * r)));
  }
  if (z !== map.getZoom()) { ourZoom = true; map.once('zoomend', () => { ourZoom = false; }); }
  map.setView(center, z, { animate: true });
};
map.on('locationfound', e => {
  lastFixAt = Date.now();
  $('locate').textContent = '◎';
  me.clearLayers();
  if (e.accuracy > 50) L.circle(e.latlng, { radius: e.accuracy, color: '#2a7de1', weight: 1, fillOpacity: .1, interactive: false }).addTo(me);
  L.marker(e.latlng, { icon: truckIcon, interactive: false, zIndexOffset: 2000 }).addTo(me);
  updateHeading(e);
  updateSpeed(e);
  addPoint(e.latlng.lat, e.latlng.lng, e.accuracy);
  applyNight();
  if (settings.headUp && heading !== null && Math.abs(((map.getBearing() + heading) % 360 + 540) % 360 - 180) > 3) map.setBearing(-heading);
  // Leaflet ignore un setView demandé pendant une animation de zoom (cadrage du trajet à l'ouverture) :
  // on attend alors la fin de l'animation
  if (firstFix) {
    const zoomIn = () => { ourZoom = true; map.once('zoomend', () => { ourZoom = false; }); map.setView(e.latlng, Math.max(map.getZoom(), 15)); };
    map._animatingZoom ? map.once('zoomend', zoomIn) : zoomIn();
    firstFix = false; framed = true;
  }
  else followView(e);
  renderDrive({ lat: e.latlng.lat, lng: e.latlng.lng });
});
map.on('locationerror', e => {
  map.stopLocate();
  following = false; settings.follow = false; saveSettings(); $('locate').classList.remove('on'); $('headUp').hidden = true; $('stage').classList.remove('driving'); northUp(); $('locate').textContent = '◎'; me.clearLayers(); $('drive').hidden = true;
  alert('Position introuvable : ' + (e.code === 1
    ? 'la localisation est refusée pour Cap Ouest.\n\n'
      + '• Chrome (Android) : touchez l\'icône à gauche de l\'adresse › Autorisations › Position › Autoriser ; vérifiez aussi Paramètres de la tablette › Applications › Chrome › Autorisations › Position.\n'
      + '• iPad : Réglages › Confidentialité › Service de localisation › Safari (ou Chrome) › « Lorsque l\'app est active ».'
    : e.message));
});

document.querySelectorAll('[name=base]').forEach(r => {
  r.checked = r.value === settings.baseMap;
  r.onchange = () => {
    Object.entries(baseMaps).forEach(([k, l]) => k === r.value ? l.addTo(map) : map.removeLayer(l));
    settings.baseMap = r.value; saveSettings();
    showBack();
  };
});
showBack();
document.querySelectorAll('[data-lyr]').forEach(cb => cb.onchange = () => {
  const l = layers[cb.dataset.lyr];
  cb.checked ? l.addTo(map) : map.removeLayer(l);
});

// ---------- Navigation : pages plein écran (onglets) et tiroir (depuis la carte) ----------
const drawer = $('drawer'), stage = $('stage');
// page = true : onglet du haut, plein écran à la place de la carte
// page = false : tiroir par-dessus la carte (depuis une fiche ou un bouton de la carte)
window.openView = (t, page = false) => {
  const tab = t === 'map' || !page ? 'map' : t;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  if (t === 'map') { drawer.classList.remove('open', 'page'); return; }
  setAdding(false);
  document.querySelectorAll('.drawer section').forEach(s => s.classList.toggle('on', s.id === t));
  $('drawerTitle').textContent = $(t).dataset.title;
  drawer.classList.toggle('page', page);
  drawer.classList.add('open');
  drawer.scrollTop = 0;
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-t], [data-open]');
  if (t) openView(t.dataset.t || t.dataset.open, !!t.dataset.t);
});
$('toggleSteps').addEventListener('click', () => {
  stage.classList.toggle(matchMedia('(max-width: 900px)').matches ? 'showsteps' : 'nosteps');
  setTimeout(() => map.invalidateSize(), 50);
});

// ---------- Largeur des panneaux (glisser la poignée) ----------
const applyWidths = () => {
  stage.style.setProperty('--sw', settings.widths.sw + 'px');
  stage.style.setProperty('--dw', settings.widths.dw + 'px');
};
applyWidths();

function makeGrip(grip, key, fromRight, min, def) {
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    stage.classList.add('dragging'); drawer.classList.add('dragging');
    const box = stage.getBoundingClientRect();
    const move = ev => {
      const w = fromRight ? box.right - ev.clientX : ev.clientX - box.left;
      settings.widths[key] = Math.round(Math.max(min, Math.min(w, box.width - 80)));
      applyWidths();
      if (key === 'sw') map.invalidateSize();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      stage.classList.remove('dragging'); drawer.classList.remove('dragging');
      map.invalidateSize();
      saveSettings();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
  // Double-clic : largeur par défaut
  grip.addEventListener('dblclick', () => { settings.widths[key] = def; applyWidths(); map.invalidateSize(); saveSettings(); });
}
makeGrip($('drawerGrip'), 'dw', true, 320, 620);
makeGrip($('stepsGrip'), 'sw', false, 240, 320);

// ---------- Paramètres ----------
const orsKey = $('orsKey'), orsMsg = $('orsMsg');
orsKey.value = settings.orsKey;
$('orsShow').onclick = () => { orsKey.type = orsKey.type === 'password' ? 'text' : 'password'; };
$('orsSave').onclick = () => {
  settings.orsKey = orsKey.value.trim();
  saveSettings();
  orsMsg.textContent = settings.orsKey ? 'Clé enregistrée sur cet appareil. Recalcul du trajet en poids lourd…' : 'Clé retirée.';
  recompute();
};
$('orsClear').onclick = () => { orsKey.value = ''; $('orsSave').onclick(); };
$('orsTest').onclick = async () => {
  const key = orsKey.value.trim();
  if (!key) { orsMsg.textContent = 'Collez d\'abord une clé.'; return; }
  orsMsg.textContent = 'Test en cours…';
  try {
    const km = await testOrs(key, settings.vehicle);
    orsMsg.textContent = `✔ La clé fonctionne (trajet test : ${km.toFixed(1)} km). Cliquez sur Enregistrer.`;
  } catch (e) {
    orsMsg.textContent = `✖ ${e.message}`;
  }
};

// Gabarit saisi en pieds, pouces et livres ; conservé en mètres et en tonnes (unités demandées par ORS).
// Seule la dimension modifiée est recalculée, pour ne pas arrondir les autres.
const FT = 0.3048, IN = 0.0254, LB_PER_T = 2204.62;
const ftIn = m => { let ft = Math.floor(m / FT + 1e-6), inch = Math.round((m - ft * FT) / IN); if (inch >= 12) { ft++; inch -= 12; } return [ft, inch]; };
function renderVehicle() {
  const v = settings.vehicle;
  [['height', v.heightM], ['width', v.widthM]].forEach(([k, m]) => { [$(k + 'Ft').value, $(k + 'In').value] = ftIn(m); });
  $('lengthFt').value = Math.round(v.lengthM / FT);
  $('weightLb').value = Math.round(v.weightT * LB_PER_T / 10) * 10;
  $('vehMetric').textContent = `Envoyé au calcul poids lourd : ${v.heightM.toFixed(2).replace('.', ',')} m de haut · ${v.lengthM.toFixed(1).replace('.', ',')} m de long · ${v.widthM.toFixed(2).replace('.', ',')} m de large · ${v.weightT.toFixed(1).replace('.', ',')} t`;
}
document.querySelectorAll('[data-veh]').forEach(inp => inp.onchange = () => {
  const k = inp.dataset.veh, n = id => Math.max(0, parseFloat($(id).value) || 0);
  const x = k === 'heightM' ? n('heightFt') * FT + n('heightIn') * IN
    : k === 'widthM' ? n('widthFt') * FT + n('widthIn') * IN
    : k === 'lengthM' ? n('lengthFt') * FT
    : n('weightLb') / LB_PER_T;
  settings.vehicle[k] = x > 0 ? +x.toFixed(3) : DEFAULT_VEHICLE[k];
  saveSettings(); renderVehicle(); renderClearances();
  if (settings.orsKey) recompute();
});
renderVehicle();

// Export GPX : étapes (waypoints + route) et tracé calculé (track), pour une appli de navigation VR
const xml = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function exportGpx(days) {
  const steps = trip.steps;
  let from = 0, to = steps.length - 1;
  if (days) {
    // Avant le départ : les 7 premiers jours du voyage
    const now = parseIso(toIso(new Date())), start = parseIso(trip.startIso);
    const today = now < start ? start : now, until = addDays(today, days);
    // Étape où l'on dort ce soir (ou le départ si le voyage n'est pas commencé), jusqu'à J+days
    from = now < start ? 0 : Math.max(0, steps.findIndex((s, i) => addDays(arrival(i), s.nights) > today));
    to = steps.findIndex((s, i) => i > from && arrival(i) > until);
    to = to < 0 ? steps.length - 1 : Math.max(from + 1, to);
  }
  const sel = steps.slice(from, to + 1);
  const desc = (s, i) => [`Arrivée ${toIso(arrival(i))}`, isNight(s) ? `${s.nights} nuit${s.nights > 1 ? 's' : ''} (${TYPE_LABEL[s.type]})` : '',
    s.extra?.addr || '', s.extra?.resName ? 'Réservation : ' + s.extra.resName : ''].filter(Boolean).join(' · ');
  const pt = (tag, s, i) => `<${tag} lat="${s.lat.toFixed(6)}" lon="${s.lng.toFixed(6)}"><name>${xml(s.name)}</name><desc>${xml(desc(s, i))}</desc></${tag}>`;
  const trk = legs.slice(from, to).filter(l => l.provider !== 'ferry').map(l => {
    let last = null;
    const kept = l.coords.filter((p, k) => { if (k && k < l.coords.length - 1 && last && hav(last, p) < 0.3) return false; last = p; return true; });
    return `<trkseg>${kept.map(p => `<trkpt lat="${p[0].toFixed(5)}" lon="${p[1].toFixed(5)}"/>`).join('')}</trkseg>`;
  }).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cap Ouest" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${xml(`Cap Ouest : ${sel[0].name.split(',')[0]} → ${sel[sel.length - 1].name.split(',')[0]}`)}</name></metadata>
${sel.map((s, k) => pt('wpt', s, from + k)).join('\n')}
<rte><name>${xml('Cap Ouest – étapes')}</name>
${sel.map((s, k) => pt('rtept', s, from + k)).join('\n')}
</rte>
<trk><name>${xml('Cap Ouest – trajet calculé')}</name>
${trk}
</trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `cap-ouest-${days ? days + '-jours-' : ''}${toIso(new Date())}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('dataMsg').textContent = `✔ GPX créé : ${sel.length} étapes (${sel[0].name.split(',')[0]} → ${sel[sel.length - 1].name.split(',')[0]}).`;
}
$('gpxWeek').onclick = () => exportGpx(7);
$('gpxAll').onclick = () => exportGpx(0);

$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportTrip()], { type: 'application/json' }));
  a.download = `cap-ouest-itineraire-${toIso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    importTrip(await file.text());
    renderMarkers(); recompute(); fitRoute();
    $('dataMsg').textContent = `✔ Itinéraire importé (${trip.steps.length} étapes).`;
  } catch (err) {
    $('dataMsg').textContent = `✖ ${err.message}`;
  }
  e.target.value = '';
};
$('clearRoutes').onclick = () => {
  clearRouteCache();
  clearStationCache();
  clearClearanceCache();
  clearPoiCache();
  $('dataMsg').textContent = 'Cache vidé. Recalcul du trajet, des stations et des découvertes…';
  recompute();
};

// ---------- Synchronisation ----------
const SYNC_LABEL = {
  init: ['☁ …', 'Démarrage…', ''],
  signedout: ['☁ non connecté', 'Non connecté · données sur cet appareil seulement', 'b'],
  syncing: ['☁ synchro…', 'Synchronisation en cours…', ''],
  synced: ['☁ à jour', '✔ À jour', 'c'],
  offline: ['☁ hors ligne', 'Hors ligne · envoi au retour du réseau', 'b'],
  error: ['☁ erreur', 'Erreur de synchronisation', 'x'],
  unavailable: ['☁ indisponible', 'Indisponible (hors ligne au démarrage)', 'b'],
};
onStatus((status, detail, user) => {
  const [chip, text, cls] = SYNC_LABEL[status] || SYNC_LABEL.init;
  $('syncChip').textContent = chip;
  $('syncChip').className = 'chip ' + cls;
  $('syncState').textContent = text;
  $('syncMsg').textContent = detail || '';
  $('syncSignedOut').hidden = !!user;
  $('syncSignedIn').hidden = !user;
  $('syncUser').textContent = user?.email || '—';
});
onRemoteChange(() => { renderMarkers(); recompute(); });

$('syncSignIn').onclick = async () => {
  const email = $('syncEmail').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('syncMsg').textContent = 'Entrez un courriel valide.'; return; }
  $('syncMsg').textContent = 'Envoi…';
  try {
    await signIn(email);
    $('syncCodeRow').hidden = false;
    $('syncCode').focus();
    $('syncMsg').textContent = `✔ Code envoyé à ${email} (vérifiez les indésirables). Il est valide une heure.`;
  } catch (e) {
    $('syncMsg').textContent = `✖ ${e.message}`;
  }
};
$('syncVerify').onclick = async () => {
  const email = $('syncEmail').value.trim();
  const code = $('syncCode').value.replace(/\D/g, '');
  if (code.length < 6) { $('syncMsg').textContent = 'Entrez le code à 6 chiffres.'; return; }
  $('syncMsg').textContent = 'Vérification…';
  try {
    await verifyCode(email, code);
    $('syncCode').value = '';
    $('syncCodeRow').hidden = true;
    $('syncMsg').textContent = '✔ Connecté.';
  } catch (e) {
    $('syncMsg').textContent = /expired|invalid/i.test(e.message) ? '✖ Code invalide ou expiré. Demandez un nouveau code.' : `✖ ${e.message}`;
  }
};
$('syncCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('syncVerify').click(); });

$('syncPassIn').onclick = async () => {
  const email = $('syncEmail').value.trim(), pass = $('syncPass').value;
  if (!/^\S+@\S+\.\S+$/.test(email) || !pass) { $('syncMsg').textContent = 'Entrez votre courriel et votre mot de passe.'; return; }
  $('syncMsg').textContent = 'Connexion…';
  try {
    await signInPassword(email, pass);
    $('syncPass').value = '';
    $('syncMsg').textContent = '✔ Connecté.';
  } catch (e) {
    $('syncMsg').textContent = /invalid/i.test(e.message)
      ? '✖ Courriel ou mot de passe incorrect. Le mot de passe se crée d’abord sur un appareil déjà connecté.'
      : `✖ ${e.message}`;
  }
};
$('syncPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('syncPassIn').click(); });

$('syncSetPass').onclick = async () => {
  const pass = $('syncNewPass').value;
  if (pass.length < 8) { $('syncMsg').textContent = 'Le mot de passe doit avoir au moins 8 caractères.'; return; }
  try {
    await setPassword(pass);
    $('syncNewPass').value = '';
    $('syncMsg').textContent = '✔ Mot de passe enregistré. Sur vos autres appareils : courriel + ce mot de passe.';
  } catch (e) {
    $('syncMsg').textContent = `✖ ${e.message}`;
  }
};
$('syncNowBtn').onclick = () => syncNow();
$('syncOut').onclick = () => { if (confirm('Se déconnecter ? L\'itinéraire reste sur cet appareil.')) signOut(); };

// ---------- Chemin parcouru (trace GPS gardée sur cet appareil) ----------
// Redessiné au plus toutes les 10 s (la trace peut compter des dizaines de milliers de points)
const trailRenderer = L.canvas({ padding: 0.3 });
let trailTimer = null, trailDrawn = false;
function renderTrail() {
  trailTimer = null; trailDrawn = true;
  layers.trail.clearLayers();
  trailSegments().forEach(seg => L.polyline(seg, { renderer: trailRenderer, color: '#8e44ad', weight: 5, opacity: .75, interactive: false }).addTo(layers.trail));
  const tk = trailKm();
  $('trailInfo').textContent = tk.total ? `${fmt(tk.total)} km enregistrés sur cet appareil (aujourd'hui : ${fmt(tk.today)} km).` : 'Aucun trajet enregistré pour l’instant.';
}
onTrailChange(() => { if (!trailTimer) trailTimer = setTimeout(renderTrail, trailDrawn ? 10000 : 0); });
$('trailClear').onclick = () => {
  if (!confirm('Effacer tout le chemin parcouru enregistré sur cet appareil ?')) return;
  clearTrail().then(renderTrail);
};

// ---------- Mode nuit de la carte ----------
// Automatique : au coucher du soleil là où on est (position GPS, sinon centre de la carte)
function applyNight() {
  const c = lastPos || (map._loaded ? map.getCenter() : trip.steps[0]);
  const night = settings.night === 'on' || (settings.night === 'auto' && sunDown(Date.now(), c.lat, c.lng));
  $('stage').classList.toggle('night', night);
  $('stage').classList.toggle('sat', settings.baseMap === 'sat');
}
document.querySelectorAll('[name=night]').forEach(r => {
  r.checked = r.value === settings.night;
  r.onchange = () => { settings.night = r.value; saveSettings(); applyNight(); };
});
document.querySelectorAll('[name=base]').forEach(r => r.addEventListener('change', applyNight));
applyNight();
setInterval(applyNight, 60000);

// ---------- Installer l'application (sans la barre de Chrome) ----------
// Le bouton n'apparaît que si Chrome permet l'installation (pas déjà installée)
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
// iPad (se présente comme un Mac avec écran tactile), iPhone : installation par Partager › Sur l'écran d'accueil
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('installIos').hidden = !ios || standalone;
$('installAndroid').hidden = ios || standalone;
const showInstall = () => {
  const can = !!window.installPrompt && !standalone;
  $('installBtn').hidden = $('installBtn2').hidden = !can;
  $('appState').textContent = standalone ? '✔ Vous utilisez l’application installée.'
    : can ? 'Cap Ouest peut être installée sur cet appareil.' : 'Cap Ouest est ouverte dans le navigateur.';
};
const install = async () => {
  const p = window.installPrompt;
  if (!p) return;
  p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === 'accepted') window.installPrompt = null;
  showInstall();
};
$('installBtn').onclick = $('installBtn2').onclick = install;
document.addEventListener('installable', showInstall);
addEventListener('appinstalled', () => { window.installPrompt = null; showInstall(); });
showInstall();

// ---------- Démarrage ----------
map.setView([47, -92], 4);
// Une erreur d'affichage (donnée inattendue) ne doit jamais empêcher la synchronisation de démarrer
for (const [label, fn] of [['étapes', renderMarkers], ['trajet', recompute], ['guides', renderGuides], ['iOverlander', renderIo]]) {
  try { fn(); } catch (e) { window.showStartError?.(`Affichage des ${label} : ${e.message}`, e); }
}
initSync();
// La carte n'a sa taille réelle qu'après la mise en page (et parfois plus tard si l'onglet est caché) :
// on suit sa taille et on cadre le trajet dès qu'elle est connue.
let framed = false;
new ResizeObserver(([entry]) => {
  map.invalidateSize();
  if (!framed && entry.contentRect.width > 0 && entry.contentRect.height > 0) { framed = true; fitRoute(); }
}).observe($('map'));
if (settings.follow) $('locate').click();

// Écran toujours allumé tant que l'appli est affichée (sinon la tablette se met en veille et le GPS
// de la page s'arrête). Le navigateur libère le verrou quand on quitte l'appli : on le reprend au retour,
// et au premier appui si le navigateur exige un geste de l'utilisateur.
let wakeLock = null;
const keepAwake = async () => {
  if (!('wakeLock' in navigator) || document.hidden || (wakeLock && !wakeLock.released)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { console.warn('Écran allumé', e); }
};
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('pointerdown', keepAwake);

// Application installable et utilisable hors ligne (seulement servie en http/https)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
}
