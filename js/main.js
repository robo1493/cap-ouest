/* global L */
import { YELLOWSTONE_BY, PHASE2, FUEL, FUEL_KM, TYPE_LABEL, DEFAULT_VEHICLE } from './data.js';
import { trip, settings, saveTrip, saveSettings, resetTrip, newStep, exportTrip, importTrip } from './store.js';
import { cachedOrEstimate, fetchMissing, providerOf, testOrs, clearRouteCache, PROVIDER_LABEL } from './routing.js';
import { hav, pointsAlong, fmt, fmtH } from './geo.js';
import { LEVEL, stationsAlong, fetchMissingStations, stationProgress, clearStationCache } from './stations.js';
import { initSync, onStatus, onRemoteChange, signIn, verifyCode, signOut, syncNow } from './sync.js';
import { CATS, poisAlong, fetchMissingPois, poiProgress, clearPoiCache, wikiLink, stopRadiusKm, leaveRigAt } from './pois.js';
import { cityHistory } from './history.js';
import { PLACE_CATS, DIFF, getPlaces, onPlacesChange, importPlaces } from './places.js';
import { project } from './overpass.js';

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

// ---------- Carte ----------
const map = L.map('map', { zoomControl: false, worldCopyJump: true, zoomSnap: 0.25 });
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
    ${milestoneHtml(i)}${s.extra?.note ? `<div class="src">ℹ ${esc(s.extra.note)}</div>` : ''}
    <div>${s.type === 'start' ? 'Départ' : 'Arrivée'} : <input type="date" style="width:auto" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)"></div>
    ${canType ? `<div>Nuits ici : <b>${s.nights}</b>
      <button class="btn sm" onclick="act('nights', ${i}, -1)">−</button>
      <button class="btn sm" onclick="act('nights', ${i}, 1)">+</button></div>` : ''}
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

  fuelPts = pointsAlong(legs, FUEL_KM);
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
      const long = leg.km > 400;
      const tag = leg.pending ? ' · ⏳' : leg.provider === 'estimate' ? ' · ≈ estimé'
        : leg.provider === 'ors-car' ? ' · 🚗 profil auto (fermé aux camions)' : '';
      html += leg.provider === 'ferry'
        ? `<div class="leg">↓ ⛴ traversier · ~${fmtH(leg.h)}</div>`
        : `<div class="leg ${long ? 'long' : ''}">↓ ${fmt(leg.km)} km${leg.h ? ' · ' + fmtH(leg.h) : ''}${tag}${long ? ' · plus de 400 km' : ''}</div>`;
    }
    if (isNight(s)) n++;
    const dateInput = `<input type="date" class="dt" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)" title="${s.type === 'start' ? 'Date de départ' : 'Date d\'arrivée'}">`;
    const nightsInput = isNight(s) ? ` · <input type="number" class="nt" min="1" max="30" value="${s.nights}" onchange="act('setNights', ${i}, +this.value)" title="Nuits"> nuit${s.nights > 1 ? 's' : ''}` : '';
    html += `<div class="step">
      <span class="n ${s.type}">${s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n}</span>
      <div class="d"><b onclick="focusStep(${i})">${esc(s.name)}</b>
        <small>${s.type === 'start' ? 'Départ ' : s.type === 'dest' ? 'Arrivée ' : ''}${dateInput}${nightsInput}</small>
        ${milestoneHtml(i)}${s.extra?.note ? `<small>ℹ ${esc(s.extra.note)}</small>` : ''}</div>
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
  if (last.type === 'dest') {
    last.extra = { ...(last.extra || {}), by: stepBy(last) || YELLOWSTONE_BY, label: last.extra?.label || 'Arrivée visée' };
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
    const ok = late <= 0 && early <= 0;
    const msg = late > 0 ? `en retard de ${late} j (au plus tard le ${shortDate(parseIso(by))})`
      : early > 0 ? `trop tôt de ${early} j (pas avant le ${shortDate(parseIso(from))})`
      : by ? `arrivée ${shortDate(d)}, marge ${-late} j` : `arrivée ${shortDate(d)}`;
    return { i, s, ok, msg, short: `${place} ${shortDate(d)}${ok && by ? ` (marge ${-late} j)` : ok ? '' : ` : ${late > 0 ? 'retard ' + late : 'tôt ' + early} j`}` };
  }).filter(Boolean);
}
function milestoneHtml(i) {
  const x = milestones().find(m => m.i === i);
  if (!x) return '';
  return `<small style="color:${x.ok ? 'var(--ok)' : 'var(--bad)'}">📌 ${esc(x.s.extra?.label || 'Jalon')} : ${x.msg}</small>`;
}

// ---------- Indicateurs ----------
function renderKpis() {
  const km = legs.reduce((t, l) => t + l.km, 0);
  const hours = legs.reduce((t, l) => t + (l.h || 0), 0);
  const nights = trip.steps.reduce((t, s) => t + s.nights, 0);
  const nb = trip.steps.filter(s => s.type === 'b').reduce((t, s) => t + s.nights, 0);
  const litres = km * FUEL.lPer100 / 100;
  const set = (id, v) => { $(id).textContent = v; };
  set('kKm', fmt(km));
  set('kHours', legs.every(l => l.h) ? fmtH(hours) : '—');
  set('kDays', nights);
  set('kAvg', fmt(km / Math.max(1, legs.length)));
  set('kL', fmt(litres) + ' L');
  set('kCost', fmt(litres * FUEL.priceCad) + ' $');
  set('kNights', `${nb} / ${nights - nb}`);
  set('kFuel', fuelPts.length);
  const p = providerOf(routeOpts());
  $('dashNote').textContent = `Distances : ${PROVIDER_LABEL[p]}. Consommation ${FUEL.lPer100} L/100 km et prix ${FUEL.priceCad.toFixed(2).replace('.', ',')} $ CA/L provisoires. Tous les montants en $ CA.`;
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
  }
  refresh(geometry);
  if (hadPopup && ['nights', 'type', 'date', 'leaveRig'].includes(what)) markers.get(s.id)?.openPopup();
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

// ---------- Outils de la carte ----------
const fitRoute = () => map.fitBounds(L.latLngBounds(trip.steps.map(s => [s.lat, s.lng])), { padding: [40, 40] });
$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();
$('fit').onclick = fitRoute;
$('locate').onclick = () => map.locate({ setView: true, maxZoom: 10 });

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
$('syncNowBtn').onclick = () => syncNow();
$('syncOut').onclick = () => { if (confirm('Se déconnecter ? L\'itinéraire reste sur cet appareil.')) signOut(); };

// ---------- Démarrage ----------
map.setView([47, -92], 4);
renderMarkers();
recompute();
renderGuides();
initSync();
// La carte n'a sa taille réelle qu'après la mise en page (et parfois plus tard si l'onglet est caché) :
// on suit sa taille et on cadre le trajet dès qu'elle est connue.
let framed = false;
new ResizeObserver(([entry]) => {
  map.invalidateSize();
  if (!framed && entry.contentRect.width > 0 && entry.contentRect.height > 0) { framed = true; fitRoute(); }
}).observe($('map'));

// Application installable et utilisable hors ligne (seulement servie en http/https)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
}
