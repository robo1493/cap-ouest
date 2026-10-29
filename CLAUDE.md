# Cap Ouest — consignes pour Claude

Application web de planification d'un long voyage en fifth wheel (Québec → Ouest canadien et américain → hiver en Arizona → retour au Québec). Interface **en français**, montants **en $ CA**. L'utilisateur n'est pas développeur : lui répondre en français, simplement, et lui dire quoi faire concrètement (fermer et rouvrir l'appli, Ctrl+F5, etc.).

## Ce dépôt est PUBLIC
- Ne jamais commiter de clé ou de secret : la clé OpenRouteService est saisie par appareil dans l'appli (localStorage), jamais dans un fichier. Supabase : seule la clé *publishable* est dans `js/config.js` (jamais `service_role` ni la clé secrète).
- Ne jamais commiter de données personnelles : le dossier `Data/` (guides PDF, export iOverlander, exports d'itinéraire) est dans `.gitignore` et n'existe que sur le portable de l'utilisateur. Les données personnelles passent par les boutons d'import de l'appli puis la synchro Supabase privée (RLS par utilisateur).
- Avant chaque push : `git ls-files | grep -ci '^data/'` doit donner 0.

## Architecture
- Statique, **sans compilation** ni Node : HTML + modules ES. Leaflet 1.9.4 (cdnjs) + leaflet-rotate 0.2.8 (jsdelivr ; carte « route devant » en mode conduite, bouton 🧭). Fonds de carte Esri (OSM/CARTO refusent les requêtes sans Referer).
- Hébergement : GitHub Pages, branche `main`, racine → https://robo1493.github.io/cap-ouest/
- PWA : `sw.js` réseau d'abord (`cache: 'no-cache'`), `manifest.webmanifest`.
- Serveur local de test : `python -m http.server 5173` dans ce dossier.

### Modules (`js/`)
- `main.js` : toute l'interface (carte, fiches d'étape `popupHtml`, liste, calendrier, tableau de bord `renderKpis`, jalons, rattrapage, mode conduite `renderDrive`, handler global `act(what, i, v)`).
- `store.js` : `trip` (étapes), `settings` (clé ORS, gabarit, `maxKmDay`, `lPer100`, etc.), sauvegarde localStorage.
- `sync.js` : Supabase (client chargé depuis jsdelivr), connexion courriel + mot de passe ; `syncNow` = trajet (le plus récent gagne) puis `syncPlaces` puis `syncIo`.
- `routing.js` : OSRM (sans clé) ou ORS `driving-hgv` avec gabarit (clé), repli « route la plus proche » puis profil auto (`ors-car`) ; cache des polylignes ; `routeOnce` pour le retour au trajet.
- `data.js` : étapes par défaut, `PHASE2` (suite du voyage), `FUEL`, `DEFAULT_VEHICLE`.
- `stations.js` / `overpass.js` : stations diesel via Overpass (file d'attente, serveur public lent).
- `pois.js` / `history.js` : découvertes OSM (en pause : `POI_OSM_ENABLED=false`) et histoire des villes (Wikipédia FR).
- `places.js` : « Mes guides » (lieux importés d'un JSON privé, synchronisés dans la table `places`).
- `ioverlander.js` : import CSV iOverlander (corridor de 40 km), stocké dans **IndexedDB** (base `capouest`, magasin `kv`), synchronisé comme une seule ligne `places` d'id `__ioverlander__`. Catégorie « Overnight Prohibited » exclue.
- `days.js` : compteurs de jours (États-Unis 182 j sur 12 mois glissants ; absence du Québec / RAMQ 183 j par année civile).
- `catchup.js` : propositions pour rattraper un retard (sauter un arrêt de transit, raccourcir un séjour non réservé).

### Données d'une étape
`{ id, name, lat, lng, type: 'start'|'b'(boondock)|'c'(camping)|'dest', nights, leaveRig, extra }`. `extra` (jsonb côté Supabase) : `by`/`from` (jalons de date), `label`, `ferry`, `note`, `longOk`, `reserved`/`resName`/`resNights` (réservation : date et nuits fixes), `addr` (adresse, bouton « Y aller » Google Maps). La région (États-Unis ou non) se déduit du code « , XX » à la fin du nom.

## Publier une version
1. Augmenter `VERSION` dans `sw.js` **et** l'étiquette `<small>vX.Y</small>` de `index.html` (l'utilisateur vérifie la version à l'écran).
2. Tester localement (vider caches et service worker avant de recharger).
3. Commit en français (« vX.Y : … »), push sur `main`, puis vérifier que `sw.js` en ligne porte la nouvelle version et que `/Data/...` renvoie 404.
4. Dire à l'utilisateur de fermer et rouvrir l'appli (tablette) ou Ctrl+F5 (portable).
