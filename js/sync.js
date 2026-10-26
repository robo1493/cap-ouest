// Synchronisation du voyage entre appareils via Supabase.
// - Connexion par lien envoyé par courriel (aucun mot de passe)
// - Le voyage complet est la plus petite unité : la version la plus récente gagne
// - Hors ligne, tout continue de fonctionner sur l'appareil ; l'envoi se fait au retour du réseau
// - Si la bibliothèque Supabase n'est pas disponible (hors ligne au 1er lancement), l'app fonctionne sans sync

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { trip, markSynced, replaceTrip, onTripSaved } from './store.js';
import { syncPlaces } from './places.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
const PUSH_DELAY = 2000;

let sb = null, user = null, busy = false, again = false, pushTimer = null;
let state = { status: 'init', detail: '' };
const statusListeners = [], remoteListeners = [];

function setStatus(status, detail = '') {
  state = { status, detail };
  statusListeners.forEach(cb => cb(status, detail, user));
}
export const onStatus = cb => { statusListeners.push(cb); cb(state.status, state.detail, user); };
export const onRemoteChange = cb => remoteListeners.push(cb);
export const currentUser = () => user;

export async function initSync() {
  try {
    const { createClient } = await import(LIB);
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  } catch (e) {
    setStatus('unavailable', 'Synchronisation indisponible (hors ligne au démarrage)');
    return;
  }
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  sb.auth.onAuthStateChange((_event, session) => {
    const was = user?.id;
    user = session?.user || null;
    if (user && user.id !== was) syncNow();
    if (!user) setStatus('signedout');
  });

  onTripSaved(schedulePush);
  addEventListener('online', () => syncNow());
  addEventListener('offline', () => user && setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);

  if (user) syncNow(); else setStatus('signedout');
}

export async function signIn(email) {
  if (!sb) throw new Error('Synchronisation indisponible.');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

// Code à 6 chiffres reçu par courriel : fonctionne aussi dans l'application installée,
// où le lien du courriel s'ouvrirait plutôt dans le navigateur (stockage séparé).
export async function verifyCode(email, code) {
  if (!sb) throw new Error('Synchronisation indisponible.');
  const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
}

// Mot de passe : une fois défini (depuis un appareil déjà connecté), les autres appareils se
// connectent sans courriel. Utile car Supabase gratuit limite les courriels et ne laisse plus
// modifier le modèle de courriel sans serveur d'envoi personnel.
export async function signInPassword(email, password) {
  if (!sb) throw new Error('Synchronisation indisponible.');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function setPassword(password) {
  if (!sb || !user) throw new Error('Connectez-vous d’abord.');
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

function schedulePush() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

export async function syncNow() {
  if (!sb || !user) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (busy) { again = true; return; }
  busy = true;
  setStatus('syncing');
  try {
    const { data: rows, error } = await sb.from('trips')
      .select('id, name, start_date, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const remote = rows[0];
    const dirty = trip.updatedAt > trip.syncedAt;

    if (!remote) {
      await push();                                   // premier appareil : le compte reçoit ce voyage
    } else {
      const remoteTs = Date.parse(remote.updated_at);
      const firstSyncHere = trip.id !== remote.id;    // cet appareil n'a jamais été synchronisé
      const remoteNewer = remoteTs > trip.syncedAt && !(dirty && trip.updatedAt > remoteTs);
      if (firstSyncHere || remoteNewer) await pull(remote);
      else if (dirty) await push();
    }
    // Lieux de « Mes guides » : une erreur ici (table absente) ne bloque pas le voyage
    try {
      await syncPlaces(sb);
    } catch (e) {
      console.warn('Synchronisation des lieux', e);
      setStatus('synced', 'Lieux des guides non synchronisés : exécuter la mise à jour SQL (table places)');
      return;
    }
    setStatus('synced');
  } catch (e) {
    console.warn('Synchronisation', e);
    setStatus('error', e.message || String(e));
  } finally {
    busy = false;
    if (again) { again = false; syncNow(); }
  }
}

async function pull(remote) {
  const { data: steps, error } = await sb.from('steps')
    .select('*')
    .eq('trip_id', remote.id)
    .order('position');
  if (error) throw error;
  if (steps.length < 2) { trip.id = remote.id; await push(); return; }   // voyage distant vide : on le remplit
  const ts = Date.parse(remote.updated_at);
  replaceTrip({
    id: remote.id,
    name: remote.name,
    startIso: remote.start_date,
    steps: steps.map(s => ({
      id: s.id, name: s.name, lat: s.lat, lng: s.lng, type: s.type, nights: s.nights,
      ...(s.leave_rig == null ? {} : { leaveRig: s.leave_rig }),
      ...(s.extra == null ? {} : { extra: s.extra }),
    })),
    updatedAt: ts,
    syncedAt: ts,
  });
  remoteListeners.forEach(cb => cb());
}

async function push() {
  const ts = trip.updatedAt;
  const iso = new Date(ts).toISOString();
  let { error } = await sb.from('trips').upsert({ id: trip.id, name: trip.name, start_date: trip.startIso, updated_at: iso });
  if (error) throw error;
  const rows = trip.steps.map((s, i) => ({
    id: s.id, trip_id: trip.id, position: i, name: s.name, lat: s.lat, lng: s.lng, type: s.type, nights: s.nights, updated_at: iso,
    leave_rig: s.leaveRig ?? null,
    extra: s.extra ?? null,
  }));
  ({ error } = await sb.from('steps').upsert(rows));
  // Colonnes récentes absentes (schéma pas encore mis à jour) : on envoie sans elles
  if (error && /leave_rig|extra/.test(error.message || '')) {
    console.warn('Colonnes leave_rig / extra absentes dans Supabase : exécuter la mise à jour SQL', error.message);
    ({ error } = await sb.from('steps').upsert(rows.map(({ leave_rig, extra, ...r }) => r)));
  }
  if (error) throw error;
  ({ error } = await sb.from('steps').delete().eq('trip_id', trip.id).not('id', 'in', `(${rows.map(r => r.id).join(',')})`));
  if (error) throw error;
  markSynced(ts);
}
