/* global L */
import { TARGET_ISO, FUEL, FUEL_KM, TYPE_LABEL, DEFAULT_VEHICLE } from './data.js';
import { trip, settings, saveTrip, saveSettings, resetTrip, newStep, exportTrip, importTrip } from './store.js';
import { cachedOrEstimate, fetchMissing, providerOf, testOrs, clearRouteCache, PROVIDER_LABEL } from './routing.js';
import { hav, pointsAlong, fmt, fmtH } from './geo.js';
import { initSync, onStatus, onRemoteChange, signIn, signOut, syncNow } from './sync.js';

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
// OSM et CARTO refusent les tuiles sans « Referer » (fichier ouvert en local) : on passe par Esri
const baseMaps = {
  plan: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
};
baseMaps[settings.baseMap] ? baseMaps[settings.baseMap].addTo(map) : baseMaps.plan.addTo(map);

const layers = {
  lines: L.layerGroup().addTo(map),
  fuel: L.layerGroup().addTo(map),
  ends: L.layerGroup().addTo(map),
  b: L.layerGroup().addTo(map),
  c: L.layerGroup().addTo(map),
  preview: L.layerGroup().addTo(map),
};
const markers = new Map();   // id d'étape → marqueur Leaflet
let legs = [];               // legs[i] : tronçon de steps[i] à steps[i+1]
let fuelPts = [];

function markerIcon(s, n) {
  const cls = s.type === 'dest' ? 'mk dest' : 'mk ' + s.type;
  const label = s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n;
  const size = s.type === 'dest' ? 32 : 26;
  return L.divIcon({ className: '', html: `<div class="${cls}">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function popupHtml(i) {
  const s = trip.steps[i], prev = trip.steps[i - 1], leg = legs[i - 1];
  const km = prev && leg ? `${fmt(leg.km)} km${leg.h ? ' · ' + fmtH(leg.h) : ''} depuis ${esc(prev.name.split(',')[0])}` : 'Point de départ';
  const canType = isNight(s);
  return `<div class="pop">
    <span class="chip ${s.type}">${TYPE_LABEL[s.type]}</span>
    <input value="${esc(s.name)}" onchange="act('rename', ${i}, this.value)">
    <div>${km}</div>
    <div>${s.type === 'start' ? 'Départ' : 'Arrivée'} : <input type="date" style="width:auto" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)"></div>
    ${canType ? `<div>Nuits ici : <b>${s.nights}</b>
      <button class="btn sm" onclick="act('nights', ${i}, -1)">−</button>
      <button class="btn sm" onclick="act('nights', ${i}, 1)">+</button></div>` : ''}
    <div class="row">
      ${canType ? `<button class="btn sm" onclick="act('type', ${i})">→ ${s.type === 'b' ? 'Camping' : 'Boondock'}</button>` : ''}
      <button class="btn sm" onclick="act('nuit', ${i})">Nuitée →</button>
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
    const style = leg.provider === 'estimate' ? { color: '#777', weight: 3, opacity: .8, dashArray: '6 8' }
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
  renderStatus();
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
}

// ---------- Liste d'étapes ----------
function renderList() {
  let html = '', n = 0;
  trip.steps.forEach((s, i) => {
    if (i > 0) {
      const leg = legs[i - 1];
      const long = leg.km > 400;
      const tag = leg.pending ? ' · ⏳' : leg.provider === 'estimate' ? ' · ≈ estimé'
        : leg.provider === 'ors-car' ? ' · 🚗 profil auto (fermé aux camions)' : '';
      html += `<div class="leg ${long ? 'long' : ''}">↓ ${fmt(leg.km)} km${leg.h ? ' · ' + fmtH(leg.h) : ''}${tag}${long ? ' · plus de 400 km' : ''}</div>`;
    }
    if (isNight(s)) n++;
    const dateInput = `<input type="date" class="dt" value="${toIso(arrival(i))}" onchange="act('date', ${i}, this.value)" title="${s.type === 'start' ? 'Date de départ' : 'Date d\'arrivée'}">`;
    const nightsInput = isNight(s) ? ` · <input type="number" class="nt" min="1" max="30" value="${s.nights}" onchange="act('setNights', ${i}, +this.value)" title="Nuits"> nuit${s.nights > 1 ? 's' : ''}` : '';
    html += `<div class="step">
      <span class="n ${s.type}">${s.type === 'start' ? '⌂' : s.type === 'dest' ? '★' : n}</span>
      <div class="d"><b onclick="focusStep(${i})">${esc(s.name)}</b>
        <small>${s.type === 'start' ? 'Départ ' : s.type === 'dest' ? 'Arrivée ' : ''}${dateInput}${nightsInput}</small></div>
      ${isNight(s) ? `<div class="ctl"><button onclick="act('up', ${i})" title="Monter">↑</button><button onclick="act('down', ${i})" title="Descendre">↓</button></div>` : ''}
    </div>`;
  });
  $('stepList').innerHTML = html;
}

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
  el.title = 'Arrivée à Yellowstone';
  el.onclick = () => focusStep(trip.steps.length - 1);
  days.appendChild(el);
  days.style.gridTemplateColumns = `repeat(${k + 1}, minmax(22px, 1fr))`;

  const margin = dayDiff(arrive, parseIso(TARGET_ISO));
  const m = $('margin');
  m.textContent = margin >= 0 ? `Arrivée ${shortDate(arrive)} · marge ${margin} j` : `En retard de ${-margin} j sur le 1er juil.`;
  m.className = 'chip ' + (margin >= 0 ? 'c' : 'x');
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
  if (hadPopup && ['nights', 'type', 'date'].includes(what)) markers.get(s.id)?.openPopup();
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
  };
});
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
  $('dataMsg').textContent = 'Cache vidé. Recalcul du trajet…';
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
  $('syncMsg').textContent = status === 'error' ? detail : '';
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
    $('syncMsg').textContent = `✔ Lien envoyé à ${email}. Ouvrez-le sur cet appareil (vérifiez les indésirables).`;
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
