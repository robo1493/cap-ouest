// Données de l'application, gardées sur l'appareil.
// La synchronisation Supabase (sync.js) s'abonne aux enregistrements via onTripSaved.

import { DEFAULT_STEPS, DEFAULT_START, DEFAULT_VEHICLE } from './data.js';
import { RESV_DEFAULT } from './resv.js';

const TRIP_KEY = 'capouest.trip.v2';
const BACKUP_KEY = 'capouest.trip.backup';
const SETTINGS_KEY = 'capouest.settings.v1';

const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
});
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const newStep = fields => ({ id: uid(), ...fields });

// Profil de l'appareil : « perso » = appareil qui avait déjà un voyage (itinéraire d'origine et fiche Ram / Chaparral) ;
// « vierge » = nouvel appareil (un ami) : voyage vide à 2 étapes, sans les données personnelles.
const PROFILE_KEY = 'capouest.profile';
export let profile = localStorage.getItem(PROFILE_KEY);
if (profile !== 'perso' && profile !== 'vierge') {
  profile = localStorage.getItem(TRIP_KEY) || localStorage.getItem('capouest.steps.v1') ? 'perso' : 'vierge';
  try { localStorage.setItem(PROFILE_KEY, profile); } catch {}
}
export const setProfile = v => { profile = v; try { localStorage.setItem(PROFILE_KEY, v); } catch {} };

function blankSteps() {
  return [
    { name: 'Départ (à changer)', lat: 45.50, lng: -73.57, type: 'start', nights: 0 },
    { name: 'Destination (à changer)', lat: 33.66, lng: -114.21, type: 'dest', nights: 0 },
  ];
}
function inDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function freshTrip() {
  return profile === 'perso'
    ? { id: uid(), name: 'Voyage Ouest', startIso: DEFAULT_START, steps: DEFAULT_STEPS.map(newStep), updatedAt: Date.now(), syncedAt: 0 }
    : { id: uid(), name: 'Mon voyage', startIso: inDays(30), steps: blankSteps().map(newStep), updatedAt: Date.now(), syncedAt: 0 };
}

function loadTrip() {
  let t = read(TRIP_KEY);
  if (!(Array.isArray(t?.steps) && t.steps.length >= 2)) {
    // Reprise des données du wireframe, s'il y en a
    const old = read('capouest.steps.v1');
    t = Array.isArray(old) && old.length >= 2
      ? { startIso: localStorage.getItem('capouest.start.v1') || DEFAULT_START, steps: old.map(newStep), updatedAt: Date.now() }
      : freshTrip();
  }
  // Identifiants compatibles avec la base (uuid)
  if (!isUuid(t.id)) t.id = uid();
  t.steps.forEach(s => { if (!isUuid(s.id)) s.id = uid(); });
  t.name ||= profile === 'perso' ? 'Voyage Ouest' : 'Mon voyage';
  t.syncedAt ||= 0;
  return t;
}

function loadSettings() {
  const s = read(SETTINGS_KEY) || {};
  return {
    orsKey: s.orsKey || '',
    vehicle: { ...DEFAULT_VEHICLE, ...s.vehicle },
    widths: { sw: 320, dw: 620, ...read('capouest.widths.v1'), ...s.widths },
    baseMap: (!s.baseMapTemp && s.baseMap) || 'plan',   // satellite temporaire (« Vue satellite ») oublié au redémarrage
    usEntry: s.usEntry || '',
    septennial: !!s.septennial,
    lPer100: s.lPer100 || 0,
    fuelAuto: s.fuelAuto !== false,   // consommation et prix tirés du journal des pleins quand il y en a assez
    usdCad: s.usdCad || 1.38,
    campRate: s.campRate ?? 60,       // budget : prix moyen d'une nuit de camping (si l'étape n'a pas son prix)
    ferryRate: s.ferryRate ?? 450,    // budget : estimation d'un traversier avec le rig (si non précisé)         // taux de change pour les pleins payés en $ US
    maxKmDay: s.maxKmDay || 0,
    lockSteps: s.lockSteps !== false,   // 🔒 étapes verrouillées sur la carte (pas de déplacement par erreur) ; cet appareil
    follow: !!s.follow, // suivi GPS relancé à l'ouverture (cet appareil seulement)
    headUp: s.headUp !== false, // en mode conduite, la carte tourne : route devant (sinon nord en haut)
    night: ['auto', 'on', 'off'].includes(s.night) ? s.night : 'auto',
    resv: { ...RESV_DEFAULT, ...s.resv },   // paramètres de réservation (📅 dans la fiche d'étape)   // carte sombre (auto : au coucher du soleil)
  };
}

export const trip = loadTrip();
export const settings = loadSettings();

const savedListeners = [];
export const onTripSaved = cb => savedListeners.push(cb);

// Enregistre une modification faite par l'utilisateur (date de modification mise à jour)
// ---------- Retour arrière (↶ Annuler) ----------
// Avant chaque enregistrement, l'état précédent (nom, date de départ, étapes) est gardé en mémoire.
// Les 30 derniers états sont disponibles jusqu'à la fermeture de l'application.
const UNDO_MAX = 30;
const undoStack = [];
const snap = () => JSON.stringify({ name: trip.name, startIso: trip.startIso, steps: trip.steps });
let lastSnap = snap();
const undoListeners = [];
export const onUndoChange = cb => undoListeners.push(cb);
export const canUndo = () => undoStack.length > 0;
const undoChanged = () => undoListeners.forEach(cb => cb());

function remember() {
  const now = snap();
  if (now === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  lastSnap = now;
  undoChanged();
}

// Remet le voyage comme avant la dernière modification ; renvoie false s'il n'y a rien à annuler
export function undoTrip() {
  const prev = undoStack.pop();
  if (!prev) return false;
  const t = JSON.parse(prev);
  trip.name = t.name; trip.startIso = t.startIso; trip.steps = t.steps;
  lastSnap = prev;
  trip.updatedAt = Date.now();
  write(TRIP_KEY, trip);
  savedListeners.forEach(cb => cb());
  undoChanged();
  return true;
}

export function saveTrip() {
  remember();
  trip.updatedAt = Date.now();
  write(TRIP_KEY, trip);
  savedListeners.forEach(cb => cb());
}

// Après une synchronisation réussie : les deux côtés sont identiques à cette date
export function markSynced(ts) {
  trip.syncedAt = ts;
  write(TRIP_KEY, trip);
}

// Remplace le voyage local par celui reçu du serveur (copie de sécurité de l'ancien)
export function replaceTrip(t) {
  write(BACKUP_KEY, trip);
  Object.keys(trip).forEach(k => delete trip[k]);
  Object.assign(trip, t);
  write(TRIP_KEY, trip);
  // Changement venu d'un autre appareil : le retour arrière repart de ce nouvel état
  undoStack.length = 0; lastSnap = snap(); undoChanged();
}

export function saveSettings() {
  write(SETTINGS_KEY, settings);
}

export function resetTrip() {
  const { id, syncedAt } = trip;
  Object.assign(trip, freshTrip(), { id, syncedAt });
  saveTrip();
}

export function exportTrip() {
  return JSON.stringify({ app: 'cap-ouest', version: 2, trip }, null, 2);
}

export function importTrip(text) {
  const data = JSON.parse(text);
  const t = data.trip || data;
  if (!Array.isArray(t.steps) || t.steps.length < 2) throw new Error('Fichier invalide : aucune étape.');
  trip.startIso = t.startIso || DEFAULT_START;
  if (typeof t.name === 'string' && t.name.trim()) trip.name = t.name.trim();
  // v1.71 : fichier d'un autre voyage (ex. partagé par un ami) → nouveaux numéros d'étapes, sinon la
  // synchronisation échoue (clé déjà prise par l'autre utilisateur). Sa propre sauvegarde garde ses numéros
  // (liens des notes vers les étapes).
  const same = isUuid(t.id) && t.id === trip.id;
  trip.steps = t.steps.map(s => ({
    id: same && isUuid(s.id) ? s.id : uid(), name: s.name, lat: +s.lat, lng: +s.lng, type: s.type, nights: +s.nights || 0,
    ...(typeof s.leaveRig === 'boolean' ? { leaveRig: s.leaveRig } : {}),
    ...(s.extra && typeof s.extra === 'object' ? { extra: s.extra } : {}),
  }));
  saveTrip();
}
