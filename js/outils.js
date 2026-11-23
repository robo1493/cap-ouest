// 🧰 Outils : liste de départ / d'arrivée à cocher, suivi des réservoirs (complément des sondes), convertisseur.
// Tout est gardé sur l'appareil (localStorage) : pas de synchronisation.

const CK = 'capouest.check.v1', TK = 'capouest.tanks.v1';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

// ---------- ✅ Listes de départ et d'arrivée ----------
const DEFAULT_LISTS = {
  dep: { title: '🚐 Départ (atteler et partir)', items: [
    'Intérieur : objets rangés, portes d’armoires, frigo et tiroirs verrouillés',
    'Laveuse vide et porte fermée',
    'Évents de toit, hotte et fenêtres fermés',
    'Auvent fermé et verrouillé ; antenne et Starlink rangés',
    'Extensions (slide-outs) rentrées et verrouillées',
    'Électricité débranchée (protecteur EMS et câble rangés)',
    'Eau de la ville débranchée, boyau et filtre rangés ; pompe à eau fermée',
    'Réservoirs : valves fermées, bouchon du drain en place, boyau d’égout rangé',
    'Chauffe-eau et four éteints ; propane selon votre habitude (fermé pour faire le plein)',
    'Stabilisateurs remontés, blocs et cales de niveau retirés et rangés',
    'Hayon du Ram ouvert avant de reculer sous la roulotte',
    'Sellette : mâchoire verrouillée, goupille en place, test en tirant vers l’avant',
    'Câble 7 broches branché + câble du frein d’urgence (breakaway) accroché au camion',
    'Béquilles avant remontées au complet ; hayon du Ram refermé',
    'Cales de roues retirées et rangées',
    'Test des feux : freins, clignotants, marche arrière',
    'Test du frein de la roulotte (contrôleur de freins)',
    'Pression des pneus (Ram et roulotte), à froid',
    'Marches remontées, porte d’entrée et soutes verrouillées',
    'Dernier tour complet à pied (rien d’oublié sur le site)',
  ] },
  arr: { title: '🏕️ Arrivée (dételer et s’installer)', items: [
    'Regarder le site à pied : branches, poteaux, pente, place pour les extensions',
    'Cales de roues posées AVANT de dételer',
    'Hayon du Ram ouvert',
    'Béquilles avant descendues, câble 7 broches et frein d’urgence débranchés',
    'Mâchoire de la sellette déverrouillée, puis dételer',
    'Mise à niveau (côté et avant-arrière), puis stabilisateurs',
    'Extensions sorties (vérifier l’espace avant)',
    'Électricité : protecteur EMS d’abord, puis brancher ; vérifier le Victron',
    'Eau : régulateur de pression et filtre, puis brancher',
    'Égout : boyau bien fixé des deux bouts (valves fermées jusqu’à la vidange)',
    'Frigo, chauffe-eau rallumés ; détecteurs de CO et de propane allumés',
    'Hayon du Ram refermé',
  ] },
};

function lists() {
  const s = get(CK, null);
  if (s && s.dep && s.arr) return s;
  const fresh = {};
  for (const [k, l] of Object.entries(DEFAULT_LISTS)) fresh[k] = { title: l.title, items: l.items.map(t => ({ t, on: false })) };
  return fresh;
}

function renderChecks(node) {
  const L = lists();
  node.innerHTML = Object.entries(L).map(([k, l]) => {
    const done = l.items.filter(i => i.on).length, all = l.items.length;
    return `<div class="ckList" data-k="${k}">
      <div class="row between"><h3 style="margin:0">${esc(l.title)}</h3>
        <span class="ckCount ${done === all ? 'ok' : ''}">${done === all ? '✔ tout est fait' : `${done} / ${all}`}</span></div>
      ${l.items.map((it, i) => `<label class="ckItem${it.on ? ' on' : ''}"><input type="checkbox" data-i="${i}"${it.on ? ' checked' : ''}>
        <span>${esc(it.t)}</span><button class="ckDel" data-del="${i}" title="Retirer de la liste">✕</button></label>`).join('')}
      <div class="row" style="margin-top:6px">
        <input class="inp ckNew" placeholder="Ajouter un point à cette liste" style="flex:1">
        <button class="btn sm ckAdd">+ Ajouter</button>
        <button class="btn sm ckReset">↺ Tout décocher</button>
      </div></div>`;
  }).join('') + '<div class="row" style="margin-top:8px"><button class="btn sm" id="ckDefaults">Remettre les listes d’origine</button></div>';
  node.onclick = e => {
    const box = e.target.closest('.ckList'); const k = box?.dataset.k;
    const L2 = lists();
    if (e.target.id === 'ckDefaults') {
      if (confirm('Remettre les deux listes d’origine ? Vos points ajoutés seront retirés.')) { localStorage.removeItem(CK); renderChecks(node); }
      return;
    }
    if (!k) return;
    if (e.target.dataset.del != null) {
      e.preventDefault();
      const i = +e.target.dataset.del;
      if (confirm(`Retirer « ${L2[k].items[i].t} » ?`)) { L2[k].items.splice(i, 1); put(CK, L2); renderChecks(node); }
    } else if (e.target.classList.contains('ckAdd')) {
      const v = box.querySelector('.ckNew').value.trim();
      if (v) { L2[k].items.push({ t: v.slice(0, 160), on: false }); put(CK, L2); renderChecks(node); }
    } else if (e.target.classList.contains('ckReset')) {
      L2[k].items.forEach(i => { i.on = false; }); put(CK, L2); renderChecks(node);
    }
  };
  node.onchange = e => {
    if (e.target.type !== 'checkbox') return;
    const k = e.target.closest('.ckList').dataset.k, L2 = lists();
    L2[k].items[+e.target.dataset.i].on = e.target.checked; put(CK, L2); renderChecks(node);
  };
}

// ---------- 💧 Réservoirs ----------
const EV = { dump: '🚽 Vidange faite', water: '💧 Eau potable remplie', wash: '🧺 Brassée de lavage' };
function tanks() { return get(TK, { log: [], dumpDays: 4, waterDays: 4 }); }
const ago = t => {
  const h = (Date.now() - t) / 3600e3;
  return h < 1 ? 'il y a moins d’une heure' : h < 36 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} jours`;
};
const last = (s, kind) => s.log.find(e => e.k === kind);

export function tankAlerts() {
  const s = tanks(), out = [], now = Date.now();
  const d = last(s, 'dump'), w = last(s, 'water');
  if (d && (now - d.t) / 864e5 >= s.dumpDays) out.push('🚽 vidange à faire');
  if (w && (now - w.t) / 864e5 >= s.waterDays) out.push('💧 eau à remplir');
  return out;
}

function renderTanks(node, onChange) {
  const s = tanks(), now = Date.now();
  const d = last(s, 'dump'), w = last(s, 'water');
  const washes = s.log.filter(e => e.k === 'wash' && (!d || e.t > d.t)).length;
  const dueD = d && (now - d.t) / 864e5 >= s.dumpDays, dueW = w && (now - w.t) / 864e5 >= s.waterDays;
  const when = e => e ? `${ago(e.t)} (${new Date(e.t).toLocaleString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : 'jamais noté';
  node.innerHTML = `
    <div class="tkRow${dueD ? ' due blink' : ''}">🚽 Dernière vidange : <b>${when(d)}</b>${washes ? ` · ${washes} brassée${washes > 1 ? 's' : ''} de lavage depuis (eau grise)` : ''}${dueD ? ' · ⚠️ À FAIRE' : ''}</div>
    <div class="tkRow${dueW ? ' due blink' : ''}">💧 Dernier plein d’eau : <b>${when(w)}</b>${dueW ? ' · ⚠️ À FAIRE' : ''}</div>
    <div class="row" style="margin:8px 0">${Object.entries(EV).map(([k, t]) => `<button class="btn${k === 'wash' ? '' : ' pri'}" data-ev="${k}">${t}</button>`).join('')}</div>
    <div class="row">
      <label>Rappel de vidange après <input type="number" min="1" max="30" id="tkDump" value="${s.dumpDays}" style="width:4em"> jours</label>
      <label>Rappel d’eau après <input type="number" min="1" max="30" id="tkWater" value="${s.waterDays}" style="width:4em"> jours</label>
    </div>
    <p class="src">Chaque brassée de lavage ajoute environ 50 à 80 L d’eau grise : laver le jour où l’on va vider. Le rappel clignote aussi dans la bande du haut.</p>
    ${s.log.length ? `<details><summary>Historique (${Math.min(s.log.length, 15)} derniers)</summary>${s.log.slice(0, 15).map((e, i) =>
      `<div class="tkLog">${EV[e.k]} · ${new Date(e.t).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        <button class="ckDel" data-undo="${i}" title="Effacer">✕</button></div>`).join('')}</details>` : ''}`;
  node.onclick = e => {
    const s2 = tanks();
    if (e.target.dataset.ev) { s2.log.unshift({ k: e.target.dataset.ev, t: Date.now() }); s2.log = s2.log.slice(0, 60); }
    else if (e.target.dataset.undo != null) s2.log.splice(+e.target.dataset.undo, 1);
    else return;
    put(TK, s2); renderTanks(node, onChange); onChange?.();
  };
  node.onchange = e => {
    const s2 = tanks(), v = Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 4));
    if (e.target.id === 'tkDump') s2.dumpDays = v; else if (e.target.id === 'tkWater') s2.waterDays = v; else return;
    put(TK, s2); renderTanks(node, onChange); onChange?.();
  };
}

// ---------- 🔄 Convertisseur ----------
// [libellé A, libellé B, A→B, B→A, décimales]
function convPairs(rate) {
  return [
    ['°C', '°F', c => c * 9 / 5 + 32, f => (f - 32) * 5 / 9, 0],
    ['litres', 'gallons US', l => l / 3.78541, g => g * 3.78541, 1],
    ['km', 'milles', k => k / 1.609344, m => m * 1.609344, 0],
    ['km/h', 'mph', k => k / 1.609344, m => m * 1.609344, 0],
    ['$ CA', '$ US', c => c / rate, u => u * rate, 2],
    ['$ CA / litre', '$ US / gallon', c => c * 3.78541 / rate, u => u * rate / 3.78541, 2],
    ['L / 100 km', 'milles / gallon US', l => 235.215 / l, m => 235.215 / m, 1],
    ['mètres', 'pieds', m => m / 0.3048, f => f * 0.3048, 2],
    ['kg', 'lb', k => k * 2.20462, l => l / 2.20462, 0],
    ['bar', 'psi', b => b * 14.5038, p => p / 14.5038, 1],
  ];
}
const ftIn = ft => { const t = Math.round(ft * 12); return `${Math.floor(t / 12)}′ ${t % 12}″`; };

function renderConv(node, getRate) {
  const rate = getRate() || 1.38;
  const P = convPairs(rate);
  node.innerHTML = P.map(([a, b], i) => `<div class="cvRow" data-i="${i}">
      <input class="inp" type="number" step="any" inputmode="decimal" data-s="a" aria-label="${esc(a)}"><span class="cvU">${esc(a)}</span>
      <span class="cvEq">=</span>
      <input class="inp" type="number" step="any" inputmode="decimal" data-s="b" aria-label="${esc(b)}"><span class="cvU">${esc(b)}</span>
      ${i === 7 ? '<span class="cvX" data-ft></span>' : ''}</div>`).join('')
    + `<p class="src">Taux utilisé : 1 $ US = ${rate.toFixed(2)} $ CA (le même que pour les pleins, onglet Carburant). Hauteur des ponts : écrivez les pieds avec décimales (13,5 = 13′ 6″).</p>`;
  node.oninput = e => {
    const row = e.target.closest('.cvRow'); if (!row) return;
    const [, , ab, ba, dec] = P[+row.dataset.i];
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    const other = row.querySelector(`[data-s="${e.target.dataset.s === 'a' ? 'b' : 'a'}"]`);
    if (!Number.isFinite(v) || (row.dataset.i === '6' && v === 0)) { other.value = ''; return; }
    const r = e.target.dataset.s === 'a' ? ab(v) : ba(v);
    other.value = (Math.round(r * 10 ** dec) / 10 ** dec).toString();
    const ft = row.querySelector('[data-ft]');
    if (ft) ft.textContent = ftIn(e.target.dataset.s === 'a' ? r : v);
  };
}

export function initOutils({ checks, tanksNode, conv, getRate, onTanks }) {
  if (checks) renderChecks(checks);
  if (tanksNode) renderTanks(tanksNode, onTanks);
  if (conv) renderConv(conv, getRate);
  return {
    refreshTanks: () => tanksNode && renderTanks(tanksNode, onTanks),
    refreshConv: () => conv && renderConv(conv, getRate),
  };
}
