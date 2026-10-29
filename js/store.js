// Données de l'application, gardées sur l'appareil.
// La synchronisation Supabase (sync.js) s'abonne aux enregistrements via onTripSaved.

import { DEFAULT_STEPS, DEFAULT_START, DEFAULT_VEHICLE } from './data.js';

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

function freshTrip() {
  return { id: uid(), name: 'Voyage Ouest', startIso: DEFAULT_START, steps: DEFAULT_STEPS.map(newStep), updatedAt: Date.now(), syncedAt: 0 };
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
  t.name ||= 'Voyage Ouest';
  t.syncedAt ||= 0;
  return t;
}

function loadSettings() {
  const s = read(SETTINGS_KEY) || {};
  return {
    orsKey: s.orsKey || '',
    vehicle: { ...DEFAULT_VEHICLE, ...s.vehicle },
    widths: { sw: 320, dw: 620, ...read('capouest.widths.v1'), ...s.widths },
    baseMap: s.baseMap || 'plan',
    usEntry: s.usEntry || '',
    septennial: !!s.septennial,
    lPer100: s.lPer100 || 0,
    maxKmDay: s.maxKmDay || 0,
    follow: !!s.follow, // suivi GPS relancé à l'ouverture (cet appareil seulement)
    headUp: s.headUp !== false, // en mode conduite, la carte tourne : route devant (sinon nord en haut)
  };
}

export const trip = loadTrip();
export const settings = loadSettings();

const savedListeners = [];
export const onTripSaved = cb => savedListeners.push(cb);

// Enregistre une modification faite par l'utilisateur (date de modification mise à jour)
export function saveTrip() {
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
  trip.steps = t.steps.map(s => ({
    id: isUuid(s.id) ? s.id : uid(), name: s.name, lat: +s.lat, lng: +s.lng, type: s.type, nights: +s.nights || 0,
    ...(typeof s.leaveRig === 'boolean' ? { leaveRig: s.leaveRig } : {}),
    ...(s.extra && typeof s.extra === 'object' ? { extra: s.extra } : {}),
  }));
  saveTrip();
}
