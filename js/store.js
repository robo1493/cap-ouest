// Données de l'application, gardées sur l'appareil.
// La synchronisation Supabase viendra se brancher ici : chaque étape a déjà un id stable.

import { DEFAULT_STEPS, DEFAULT_START, DEFAULT_VEHICLE } from './data.js';

const TRIP_KEY = 'capouest.trip.v2';
const SETTINGS_KEY = 'capouest.settings.v1';

const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const newStep = fields => ({ id: uid(), ...fields });

function freshTrip() {
  return { startIso: DEFAULT_START, steps: DEFAULT_STEPS.map(newStep), updatedAt: Date.now() };
}

function loadTrip() {
  const t = read(TRIP_KEY);
  if (Array.isArray(t?.steps) && t.steps.length >= 2) return t;
  // Reprise des données du wireframe, s'il y en a
  const old = read('capouest.steps.v1');
  if (Array.isArray(old) && old.length >= 2) {
    return { startIso: localStorage.getItem('capouest.start.v1') || DEFAULT_START, steps: old.map(newStep), updatedAt: Date.now() };
  }
  return freshTrip();
}

function loadSettings() {
  const s = read(SETTINGS_KEY) || {};
  return {
    orsKey: s.orsKey || '',
    vehicle: { ...DEFAULT_VEHICLE, ...s.vehicle },
    widths: { sw: 320, dw: 620, ...read('capouest.widths.v1'), ...s.widths },
    baseMap: s.baseMap || 'plan',
  };
}

export const trip = loadTrip();
export const settings = loadSettings();

export function saveTrip() {
  trip.updatedAt = Date.now();
  write(TRIP_KEY, trip);
}

export function saveSettings() {
  write(SETTINGS_KEY, settings);
}

export function resetTrip() {
  Object.assign(trip, freshTrip());
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
  trip.steps = t.steps.map(s => ({ id: s.id || uid(), name: s.name, lat: +s.lat, lng: +s.lng, type: s.type, nights: +s.nights || 0 }));
  saveTrip();
}
