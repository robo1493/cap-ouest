# Cap Ouest

Application de planification du voyage dans l'Ouest canadien et américain (9 mois)
en Ram 3500 2023 + fifth wheel Coachmen Chaparral 298RLS 2019.

- Carte interactive : étapes déplaçables, dates et nuits modifiables
- Trajet routier réel : OSRM (auto) sans clé, OpenRouteService (poids lourd) avec clé
- Pleins calculés à 50 % du réservoir (189 L) le long du trajet
- Rythme boondock / camping, autonomie hors-réseau, équipement

## Architecture

Site statique, **sans compilation** : HTML + modules JavaScript, servis tels quels par GitHub Pages.

| Fichier | Rôle |
|---|---|
| `index.html` | Interface (carte, pages, tiroir) |
| `css/app.css` | Styles |
| `js/main.js` | Logique de l'interface et de la carte |
| `js/routing.js` | Calcul des tronçons (OSRM / ORS) + cache local |
| `js/store.js` | Données du voyage et paramètres (sur l'appareil ; Supabase à venir) |
| `js/geo.js` | Distances, polylignes, points le long du trajet |
| `js/data.js` | Itinéraire par défaut, rig, carburant |
| `sw.js`, `manifest.webmanifest` | Application installable et hors ligne |
| `supabase/schema.sql` | Tables et règles d'accès pour la synchronisation |
| `docs/wireframe-v0.3.html` | Wireframe d'origine (archive) |

Les clés (OpenRouteService, Supabase) sont saisies dans **⚙ Paramètres** et restent
sur l'appareil. Elles ne doivent jamais être écrites dans le code : le dépôt est public.

## Lancer en local

```bash
python -m http.server 5173
```

Puis ouvrir http://localhost:5173.

## Publier sur GitHub Pages

1. Créer un dépôt `cap-ouest` sur GitHub et y pousser ce dossier.
2. Dans le dépôt : **Settings → Pages → Build and deployment → Deploy from a branch**,
   branche `main`, dossier `/ (root)`.
3. L'application est en ligne à `https://<votre-compte>.github.io/cap-ouest/`.
4. Sur la tablette : ouvrir l'adresse, puis « Ajouter à l'écran d'accueil ».

À chaque publication, augmenter `VERSION` dans `sw.js`.

## Synchronisation Supabase (prochaine étape)

1. Créer un projet sur supabase.com (gratuit).
2. SQL Editor → coller `supabase/schema.sql` → Run.
3. Project Settings → API : copier l'URL et la clé `anon` dans ⚙ Paramètres.
