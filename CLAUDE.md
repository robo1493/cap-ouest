# Cap Ouest — consignes pour Claude

Application web de planification d'un long voyage en fifth wheel (Québec → Ouest canadien et américain → hiver en Arizona → retour au Québec). Interface **en français**, montants **en $ CA**. L'utilisateur n'est pas développeur : lui répondre en français, simplement, et lui dire quoi faire concrètement (fermer et rouvrir l'appli, Ctrl+F5, etc.).

## Ce dépôt est PUBLIC
- Ne jamais commiter de clé ou de secret : la clé OpenRouteService est saisie par appareil dans l'appli (localStorage), jamais dans un fichier. Supabase : seule la clé *publishable* est dans `js/config.js` (jamais `service_role` ni la clé secrète).
- Ne jamais commiter de données personnelles : le dossier `Data/` (guides PDF, export iOverlander, exports d'itinéraire) est dans `.gitignore` et n'existe que sur le portable de l'utilisateur. Les données personnelles passent par les boutons d'import de l'appli puis la synchro Supabase privée (RLS par utilisateur).
- Avant chaque push : `git ls-files | grep -ci '^data/'` doit donner 0.

## Deux postes de travail : portable et tablette
L'utilisateur travaille avec Claude tantôt sur son portable, tantôt depuis sa tablette (session dans le nuage). GitHub (`main`) est la seule source commune.
- **Avant toute modification** : `git pull --rebase origin main` (une session ouverte depuis longtemps n'a pas les changements de l'autre poste).
- **Après chaque version** : publier tout de suite (push), ne pas garder de changements non publiés.
- Si le push est refusé : `git pull --rebase`, régler les conflits en gardant le travail des deux côtés, retester, puis pousser. Jamais de `push --force`.
- Tenir à jour la liste « À faire » ci-dessous (cocher ce qui est publié) : c'est le plan commun aux deux postes.

## À faire (liste acceptée par l'utilisateur, 2026-10-30)
- [ ] Cartes hors réseau : bouton dans ⚙ Paramètres pour télécharger d'avance la carte du corridor du trajet (respecter les conditions du fournisseur de tuiles)
  - Constat (2026-10-30) : les tuiles Esri actuelles ne permettent pas le téléchargement en masse. Piste : OpenFreeMap (vectoriel, téléchargement hors ligne permis jusqu'à 3 000 tuiles / 50 Mo par téléchargement, 4 requêtes parallèles) → afficher avec MapLibre GL dans Leaflet, télécharger « 7 prochains jours » (corridor), mise en cache par le service worker. Change l'apparence du plan ; pas de satellite hors ligne. En attente de l'accord de l'utilisateur.
- [x] Journal des pleins réels (v1.8) : odomètre, litres ou gallons US, $ CA ou $ US, lieu GPS → conso réelle, prix moyen, pleins prévus recomptés depuis le dernier plein complet, diesel payé au tableau de bord
- [x] Budget complet (v1.9) : 💲 dans la fiche (`extra.price` prévu/nuit, `extra.paid`, `extra.ferryCost`, `extra.ferryPaid`), tableau au tableau de bord ; `settings.campRate` / `ferryRate` par défaut
- [x] Export GPX (v1.10) : ⚙ Paramètres › Données, « 7 prochains jours » ou « tout le voyage » (wpt + rte des étapes, trk du tracé calculé)
- [x] Journal de voyage (v1.11) : 📔 dans la fiche (`extra.journal`), liste et export texte au tableau de bord
- [ ] Page « Suivez-nous » pour la famille (idée validée, à reprendre quand l'utilisateur le demande) : page séparée en lecture seule sur GitHub Pages (`suivi.html`), carte du trajet, position, journal et photos ; photos ajoutées depuis la fiche (réduites ~300 Ko) dans Supabase Storage (gratuit 1 Go) ; SQL à fournir à l'utilisateur. Deux choix encore à lui demander : accès par lien secret ou mot de passe ; position = étape du soir seulement ou en direct.
- [x] Fiabilité (v1.12) : caches trajets / stations / découvertes / passages bas / histoire dans IndexedDB (`kv.js`, `ready` attendu par main.js au démarrage ; reprise automatique de l'ancien localStorage)
- [ ] Tronçon Theodore Roosevelt → Badlands (520 km) ; position exacte de Charlevoix
- [ ] Autres guides (Arizona, FQCC, NPS, boucle des parcs, reste d'Authentik) — fichiers dans `Data/`, donc sur le portable seulement
- [ ] Découvertes OpenStreetMap (en pause : serveur Overpass public trop lent)
- [ ] Découper `main.js` en modules
- [x] Écran toujours allumé et GPS fiable en mode conduite (v1.6.3 à v1.7.1)
- [x] Application installable (v1.13) : icônes PNG 192/512/maskable dans le manifeste (Chrome Android n'installe pas avec la seule icône SVG), bouton « 📲 Installer l'application » (en-tête et ⚙ Paramètres) sur `beforeinstallprompt` ; iPad (v1.13.1) : pas de bouton chez Apple, aide Partager › Sur l'écran d'accueil (l'appli installée sur iPad a sa propre mémoire : resynchroniser, ressaisir la clé ORS)

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
- `fuel.js` : journal des pleins (localStorage `capouest.fuel.v1`), synchronisé dans la ligne `places` d'id `__fuel__` (fusion par id, la modification la plus récente gagne, suppressions en pierres tombales). `places.js` ne doit jamais effacer les lignes réservées (`__ioverlander__`, `__fuel__`).
- `catchup.js` : propositions pour rattraper un retard (sauter un arrêt de transit, raccourcir un séjour non réservé).
- `clearances.js` : ponts et passages bas (`maxheight` OSM via Overpass) sur la route même (≤ 60 m et même orientation : la route qui passe sous notre pont est ignorée), signalés sous la hauteur du rig + 1' 6" ; cache par tronçon.
- `trail.js` : chemin parcouru (GPS du mode conduite, un point / ~50 m), IndexedDB clé `trail`, par jour ; sur l'appareil seulement (pas synchronisé).
- `night.js` : hauteur du soleil ; mode nuit de la carte (`settings.night` auto / on / off, filtre CSS sur les tuiles).

### Données d'une étape
`{ id, name, lat, lng, type: 'start'|'b'(boondock)|'c'(camping)|'dest', nights, leaveRig, extra }`. `extra` (jsonb côté Supabase) : `by`/`from` (jalons de date), `label`, `ferry`, `note`, `longOk`, `reserved`/`resName`/`resNights` (réservation : date et nuits fixes), `addr` (adresse, bouton « Y aller » Google Maps). La région (États-Unis ou non) se déduit du code « , XX » à la fin du nom.

## Publier une version
1. Augmenter `VERSION` dans `sw.js` **et** l'étiquette `<small>vX.Y</small>` de `index.html` (l'utilisateur vérifie la version à l'écran).
2. Tester localement (vider caches et service worker avant de recharger).
3. Commit en français (« vX.Y : … »), push sur `main`, puis vérifier que `sw.js` en ligne porte la nouvelle version et que `/Data/...` renvoie 404.
4. Dire à l'utilisateur de fermer et rouvrir l'appli (tablette) ou Ctrl+F5 (portable).
