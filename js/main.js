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
import { BY_K, GROUPS, getIo, onIoChange, importIoCsv, clearIo, ioNear } from './ioverlander.js';

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

// Consommation (réglable dans Carburant) et distance avant le seuil de plein (50 % du réservoir)
const lPer100 = () => settings.lPer100 || FUEL.lPer100;
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
};
const markers = new Map();   // id d'étape → marqueur Leaflet
let legs = [];               // legs[i] : tronçon de steps[i] à steps[i+1]
let fuelPts = [];
let stations = [];
let pois = [];

function markerIcon(s, n) {
  const cls = s.type === 'dest' ? 'mk dest' : 'mk ' + s.type;
  const label = s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n;
  const size = s.type === 'dest' ? 32 : 26;
  return L.divIcon({ className: '', html: `<div class="${cls}">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

// Itinéraire dans Google Maps (application si installée) : vers l'adresse saisie, sinon vers le point de l'étape
const goUrl = s => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.extra?.addr?.trim() || `${s.lat},${s.lng}`);

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
    ${canType ? `<div>Nuits ici : <b>${s.nights}</b>
      <button class="btn sm" onclick="act('nights', ${i}, -1)">−</button>
      <button class="btn sm" onclick="act('nights', ${i}, 1)">+</button></div>` : ''}
    ${s.type !== 'start' ? `<div class="resv"><label><input type="checkbox" ${s.extra?.reserved ? 'checked' : ''} onchange="act('reserve', ${i}, this.checked)">
      📌 Réservation (date et nuits fixes)</label>
      ${s.extra?.reserved ? `<input placeholder="Camping, n° de réservation…" value="${esc(s.extra.resName || '')}" onchange="act('resName', ${i}, this.value)">` : ''}</div>` : ''}
    ${s.type !== 'start' ? `<div class="addr"><input placeholder="Adresse (camping, rue, ville…)" value="${esc(s.extra?.addr || '')}" onchange="act('addr', ${i}, this.value)">
      <a class="btn sm" href="${goUrl(s)}" target="_blank" rel="noopener" title="Itinéraire dans Google Maps">🧭 Y aller</a></div>` : ''}
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

function renderLines() {
  layers.lines.clearLayers();
  layers.fuel.clearLayers();
  legs.forEach(leg => {
    const style = leg.provider === 'ferry' ? { color: '#3d6fb4', weight: 3, opacity: .9, dashArray: '2 8' }
      : leg.provider === 'estimate' ? { color: '#777', weight: 3, opacity: .8, dashArray: '6 8' }
      : leg.provider === 'ors-car' ? { color: '#b4733d', weight: 4, opacity: .9 }
      : { color: '#222', weight: 4, opacity: .8 };
    L.polyline(leg.coords, style).addTo(layers.lines);
  });

  fuelPts = pointsAlong(legs, fuelKm());
  fuelPts.forEach((p, k) => {
    const a = trip.steps[p.leg], b = trip.steps[p.leg + 1];
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="fu"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
      .bindPopup(`<div class="pop"><b>■ Plein #${k + 1}</b><div>km ~${fmt(p.km)} · réservoir à 50 %</div>
        <div class="src">Entre ${esc(a.name.split(',')[0])} et ${esc(b.name.split(',')[0])}. Chercher une station facile dans un rayon de 30 km.</div>
        <div class="row"><button class="btn sm" onclick="openView('fuel')">Détails carburant →</button></div></div>`)
      .addTo(layers.fuel);
  });

  renderList();
  renderCalendar();
  renderKpis();
  renderFuelTable();
  renderStations();
  renderPois();
  renderStatus();
  loadStations();
  loadPois();
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

function ioPopup(x) {
  const c = BY_K[x[3]], p = { lat: x[0], lng: x[1] };
  let near = -1, d = Infinity;
  trip.steps.forEach((s, i) => { const k = hav(s, p); if (k < d) { d = k; near = i; } });
  return `<div class="pop">
    <span class="chip" style="border-color:${c.color};color:${c.color}">${c.icon} ${c.label}</span>
    <div><b>${esc(x[2] || 'Sans nom')}</b></div>
    <div class="src">À ${fmt(d)} km de ${esc(trip.steps[near].name.split(',')[0])} · source : iOverlander</div>
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
  list.forEach(x => {
    const c = BY_K[x[3]];
    if (!c || !ioGroupOn(c.g)) return;
    L.circleMarker([x[0], x[1]], { renderer: ioRenderer, radius: 6, color: '#fff', weight: 1.5, fillColor: c.color, fillOpacity: .9 })
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
map.on('zoomend', toggleIo);
document.querySelectorAll('[data-io]').forEach(cb => cb.onchange = renderIo);
onIoChange(renderIo);

// Résumé des lieux iOverlander proches d'une étape (fiche de l'étape)
function ioSummary(s) {
  const near = ioNear(s, 15);
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
    const r = importIoCsv(await file.text(), legs, trip.steps);
    $('dataMsg').textContent = `✔ ${fmt(r.kept)} lieux gardés près du trajet (sur ${fmt(r.read)} utiles) · ${fmt(r.total)} au total. Ils seront envoyés à votre compte.`;
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
  const io = ioNear(s, 15);
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
        ${milestoneHtml(i)}${s.extra?.note ? `<small>ℹ ${esc(s.extra.note)}</small>` : ''}${s.extra?.addr ? `<small>📍 <a href="${goUrl(s)}" target="_blank" rel="noopener">${esc(s.extra.addr)}</a></small>` : ''}</div>
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
  set('kCost', fmt(litres * FUEL.priceCad) + ' $');
  const nc = trip.steps.filter(s => s.type === 'c').reduce((t, s) => t + s.nights, 0);
  const pct = n => nb + nc ? ` (${Math.round(n / (nb + nc) * 100)} %)` : '';
  set('kNightsB', nb + pct(nb));
  set('kNightsC', nc + pct(nc));
  set('kFuel', fuelPts.length);
  $('fuelRange').textContent = `~${fmt(fuelKm())} km`;
  $('routeMaxTxt').textContent = `${fmt(maxKm())} km`;
  if (document.activeElement !== $('maxKmDay')) $('maxKmDay').value = maxKm();
  if (document.activeElement !== $('lPer100')) $('lPer100').value = lPer100();
  renderDays();
  renderCatchup();
  const p = providerOf(routeOpts());
  $('dashNote').textContent = `Distances : ${PROVIDER_LABEL[p]}. Consommation ${String(lPer100()).replace('.', ',')} L/100 km et prix ${FUEL.priceCad.toFixed(2).replace('.', ',')} $ CA/L provisoires. Tous les montants en $ CA.`;
}

function renderFuelTable() {
  const cost = FUEL.tankL * FUEL.threshold * FUEL.priceCad;
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
  if (what === 'del') { steps.splice(i, 1); map.closePopup(); geometry = true; }
  if (what === 'up' && steps[i - 1].type !== 'start') { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; geometry = true; }
  if (what === 'down' && steps[i + 1].type !== 'dest') { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; geometry = true; }
  // Changer une date d'arrivée allonge ou raccourcit le séjour à l'étape précédente
  // (pour la première étape ou le départ : décale la date de départ)
  if (what === 'date' && v) {
    const delta = dayDiff(arrival(i), parseIso(v));
    const prev = steps[i - 1];
    if (i === 0 || prev.type === 'start') trip.startIso = toIso(addDays(parseIso(trip.startIso), delta));
    else if (prev.nights + delta < 1) alert(`Impossible : ${prev.name} doit garder au moins 1 nuit. Date la plus tôt : ${addDays(arrival(i - 1), 1).toLocaleDateString('fr-CA')}`);
    else prev.nights += delta;
    if (s.extra?.reserved) s.extra = { ...s.extra, from: toIso(arrival(i)), by: toIso(arrival(i)) };
  }
  refresh(geometry);
  if (hadPopup && ['nights', 'type', 'date', 'leaveRig', 'longOk', 'reserve', 'resName', 'addr'].includes(what)) markers.get(s.id)?.openPopup();
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
  const p = { lat: e.latlng.lat, lng: e.latlng.lng };
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
});

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
  box.innerHTML = `
    ${detour ? `<div class="back">↩ Chemin de retour vers ${esc(next.name.split(',')[0])}${detour.provider === 'osrm' || detour.provider === 'ors-car' ? ' <small>(calcul auto, sans restrictions VR)</small>' : ''}
        <button class="btn sm" onclick="clearDetour()">✕</button></div>`
      : best.off > 3 ? `<div class="warn">⚠ Hors du trajet prévu (${d(best.off)})
        <button class="btn sm" id="backBtn" onclick="backToRoute()">↩ Retour au trajet</button></div>` : ''}
    <div class="big">🏁 <b>${esc(next.name.split(',')[0])}</b><span>${d(nextKm)} · ${fmtH(hours)} · arrivée ~${eta}</span></div>
    <div>⛽ ${st ? `<b>${esc(st.name)}</b> <span style="display:inline;color:${LEVEL[st.level].color}">${LEVEL[st.level].label}</span> · ${d(st.km - myKm)}` : 'Aucune station facile connue devant'}
      ${plein ? `<small>Plein prévu (réservoir à 50 %) dans ${d(plein.km - myKm)}</small>` : ''}</div>
    <div>🧭 ${poi ? `${poi.icon} <b>${esc(poi.name)}</b> · ${d(poi.km - myKm)}` : 'Aucune découverte dans les 300 prochains km'}</div>`;
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

function renderVehicle() {
  document.querySelectorAll('[data-veh]').forEach(inp => { inp.value = settings.vehicle[inp.dataset.veh]; });
  const v = settings.vehicle, ft = v.heightM / 0.3048;
  $('vehImperial').textContent = `≈ ${Math.floor(ft)}' ${Math.round((ft % 1) * 12)}" de haut · ${Math.round(v.lengthM / 0.3048)}' de long · ${fmt(v.weightT * 2204.6)} lb`;
}
document.querySelectorAll('[data-veh]').forEach(inp => inp.onchange = () => {
  const k = inp.dataset.veh, n = parseFloat(inp.value);
  settings.vehicle[k] = n > 0 ? n : DEFAULT_VEHICLE[k];
  saveSettings(); renderVehicle();
  if (settings.orsKey) recompute();
});
renderVehicle();

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

// ---------- Démarrage ----------
map.setView([47, -92], 4);
renderMarkers();
recompute();
renderGuides();
renderIo();
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
