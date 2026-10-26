// Valeurs par défaut du voyage et du rig.

// type : start | b (boondock) | c (camping / parc) | dest ; nights = nuits passées à cette étape
export const DEFAULT_STEPS = [
  { name: 'Lévis, QC', lat: 46.80, lng: -71.18, type: 'start', nights: 0 },
  { name: 'Montebello, QC', lat: 45.65, lng: -74.93, type: 'b', nights: 1 },
  { name: 'North Bay, ON', lat: 46.31, lng: -79.46, type: 'b', nights: 1 },
  { name: 'Blind River, ON', lat: 46.18, lng: -82.96, type: 'c', nights: 1 },
  { name: 'Parc prov. du Lac-Supérieur (Agawa Bay), ON', lat: 47.345, lng: -84.661, type: 'c', nights: 2 },
  { name: 'Terrace Bay, ON', lat: 48.79, lng: -87.10, type: 'b', nights: 1 },
  { name: 'Kakabeka Falls (Thunder Bay), ON', lat: 48.40, lng: -89.62, type: 'c', nights: 1 },
  { name: 'Dryden, ON', lat: 49.78, lng: -92.84, type: 'b', nights: 1 },
  { name: 'Winnipeg, MB', lat: 49.90, lng: -97.14, type: 'b', nights: 1 },
  { name: 'Parc prov. Spruce Woods, MB', lat: 49.66, lng: -99.27, type: 'c', nights: 2 },
  { name: 'Moosomin, SK', lat: 50.14, lng: -101.67, type: 'b', nights: 1 },
  { name: 'Regina, SK', lat: 50.45, lng: -104.61, type: 'b', nights: 1 },
  { name: 'Estevan, SK', lat: 49.14, lng: -102.99, type: 'c', nights: 1 },
  { name: 'Minot, ND', lat: 48.23, lng: -101.30, type: 'b', nights: 1 },
  { name: 'Theodore Roosevelt NP, ND', lat: 46.91, lng: -103.52, type: 'c', nights: 2 },
  { name: 'Badlands NP (Cedar Pass), SD', lat: 43.7506, lng: -101.9417, type: 'c', nights: 2 },
  { name: 'Gillette, WY', lat: 44.29, lng: -105.50, type: 'b', nights: 1 },
  { name: 'Billings, MT', lat: 45.78, lng: -108.50, type: 'b', nights: 1 },
  { name: 'Cody, WY', lat: 44.53, lng: -109.06, type: 'c', nights: 1 },
  { name: 'Yellowstone NP (Fishing Bridge), WY', lat: 44.56, lng: -110.37, type: 'dest', nights: 0, extra: { by: '2027-07-01', label: 'Arrivée visée' } },
];

export const DEFAULT_START = '2027-06-01';

// Jalons de dates : extra.by = arriver au plus tard ; extra.from = pas avant
export const YELLOWSTONE_BY = '2027-07-01';

// Suite proposée après Yellowstone, jusqu'au retour au Québec (mi-février 2028) : Montana et Glacier,
// Stampede de Calgary, Rocheuses, île de Vancouver (août), Okanagan (septembre), entrée aux États-Unis
// le plus tard possible, côte de l'Oregon et Californie, hiver en Arizona, retour par le sud.
// extra.ferry = tronçon d'arrivée en traversier ; extra.from / extra.by = jalons de dates.
export const PHASE2 = [
  { name: "Livingston, MT", lat: 45.6625, lng: -110.5605, type: "b", nights: 1 },
  { name: "Helena, MT", lat: 46.5891, lng: -112.0391, type: "c", nights: 2, extra: { note: "Croisière Gates of the Mountains : le paysage sans effort." } },
  { name: "Choteau, MT", lat: 47.8124, lng: -112.1836, type: "b", nights: 1, extra: { note: "Halte pour couper Helena → Glacier." } },
  { name: "St. Mary – Glacier NP (côté est), MT", lat: 48.7459, lng: -113.44, type: "c", nights: 3, leaveRig: true, extra: { note: "Going-to-the-Sun Road interdite au-delà de 21 pi : camion seul ou navette." } },
  { name: "West Glacier – Glacier NP (côté ouest), MT", lat: 48.505, lng: -113.987, type: "c", nights: 2, leaveRig: true, extra: { note: "Trail of the Cedars (facile, plat)." } },
  { name: "Parc national des Lacs-Waterton, AB", lat: 49.0485, lng: -113.9105, type: "c", nights: 1, extra: { note: "Frontière par Chief Mountain (poste saisonnier) ou Carway." } },
  { name: "Calgary (Stampede), AB", lat: 51.0866, lng: -114.235, type: "c", nights: 4, leaveRig: true, extra: { "from": "2027-07-09", by: "2027-07-15", label: "Stampede du 9 au 18 juillet", note: "Campings rares pendant le Stampede : réserver dès l’ouverture." } },
  { name: "Banff (Tunnel Mountain), AB", lat: 51.189, lng: -115.539, type: "c", nights: 3, leaveRig: true },
  { name: "Lake Louise, AB", lat: 51.417, lng: -116.179, type: "c", nights: 2, leaveRig: true, extra: { note: "Excursion dans Yoho (lac Emerald) en camion seul." } },
  { name: "Jasper, AB", lat: 52.853, lng: -118.079, type: "c", nights: 3, leaveRig: true, extra: { note: "Par la promenade des Glaciers ; vérifier les campings rouverts après les feux de 2024." } },
  { name: "Valemount, BC", lat: 52.831, lng: -119.265, type: "b", nights: 1, extra: { note: "Halte au mont Robson en route." } },
  { name: "Clearwater (Wells Gray), BC", lat: 51.651, lng: -120.038, type: "c", nights: 2, extra: { note: "Chutes Helmcken et Dawson : belvédères près des stationnements." } },
  { name: "Kamloops, BC", lat: 50.6745, lng: -120.3273, type: "b", nights: 1, extra: { note: "Vers Hope : la Coquihalla a de longues pentes de 8 % ; la route du canyon du Fraser est plus douce." } },
  { name: "Hope, BC", lat: 49.383, lng: -121.442, type: "b", nights: 1, extra: { note: "Tunnels Othello : sentier plat, idéal pour le genou." } },
  { name: "Vancouver (Burnaby), BC", lat: 49.253, lng: -122.952, type: "c", nights: 3, leaveRig: true },
  { name: "Victoria (Goldstream), BC", lat: 48.474, lng: -123.548, type: "c", nights: 4, extra: { ferry: true, note: "Traversier BC Ferries Tsawwassen → Swartz Bay (~1 h 35) : réserver, tarif selon la longueur." } },
  { name: "Pacific Rim – Ucluelet / Tofino, BC", lat: 49.059, lng: -125.723, type: "c", nights: 5, extra: { note: "Route 4 sinueuse (Kennedy Hill) : rouler lentement. Camping Green Point (Parcs Canada)." } },
  { name: "Parksville – Qualicum Beach, BC", lat: 49.317, lng: -124.312, type: "c", nights: 4, extra: { note: "Grandes plages à marée basse, promenades plates." } },
  { name: "Comox Valley, BC", lat: 49.674, lng: -124.928, type: "c", nights: 3 },
  { name: "Harrison Hot Springs, BC", lat: 49.3, lng: -121.785, type: "c", nights: 4, extra: { ferry: true, note: "Traversier Departure Bay (Nanaimo) → Horseshoe Bay, puis ~150 km de route. Bains chauds : bon pour le genou." } },
  { name: "Parc provincial Manning, BC", lat: 49.064, lng: -120.784, type: "c", nights: 3, extra: { note: "Route 3 (col Allison) : pentes soutenues mais régulières." } },
  { name: "Penticton (Okanagan), BC", lat: 49.4991, lng: -119.5937, type: "c", nights: 7, extra: { note: "Vignobles et lacs ; vendanges en septembre." } },
  { name: "Kelowna (Okanagan), BC", lat: 49.888, lng: -119.496, type: "c", nights: 7 },
  { name: "Osoyoos, BC", lat: 49.032, lng: -119.468, type: "c", nights: 7, extra: { note: "Dernière étape au Canada : climat désertique, le lac le plus chaud du pays." } },
  { name: "Leavenworth, WA", lat: 47.5962, lng: -120.6615, type: "c", nights: 2, extra: { "from": "2027-09-14", label: "Entrée aux États-Unis (le plus tard possible)", note: "Frontière Osoyoos → Oroville. Village bavarois." } },
  { name: "Hood River (gorge du Columbia), OR", lat: 45.7054, lng: -121.5215, type: "c", nights: 3, extra: { note: "Chutes Multnomah : sentier pavé jusqu’au pont (court, en pente)." } },
  { name: "Seaside – Cannon Beach, OR", lat: 45.9932, lng: -123.9226, type: "c", nights: 4 },
  { name: "Newport, OR", lat: 44.6368, lng: -124.0535, type: "c", nights: 4, extra: { note: "Aquarium et phare de Yaquina Head." } },
  { name: "Florence (dunes de l’Oregon), OR", lat: 43.9826, lng: -124.0998, type: "c", nights: 4 },
  { name: "Bandon, OR", lat: 43.119, lng: -124.4084, type: "c", nights: 4, extra: { note: "Rochers marins ; corridor Samuel H. Boardman en camion seul." } },
  { name: "Redwood NP (Orick), CA", lat: 41.287, lng: -124.059, type: "c", nights: 4, extra: { note: "Séquoias : sentiers plats (Lady Bird Johnson Grove)." } },
  { name: "Garberville – Avenue of the Giants, CA", lat: 40.1007, lng: -123.7942, type: "c", nights: 2, extra: { note: "Éviter la route 1 côtière (trop sinueuse pour le rig) : rester sur la 101." } },
  { name: "Sonoma (vignobles), CA", lat: 38.2919, lng: -122.458, type: "c", nights: 5 },
  { name: "San Francisco (Pacifica), CA", lat: 37.6277, lng: -122.4886, type: "c", nights: 4, leaveRig: true },
  { name: "Monterey, CA", lat: 36.6002, lng: -121.8947, type: "c", nights: 6, leaveRig: true, extra: { note: "Big Sur (route 1) en camion seul : éboulements fréquents, vérifier l’état de la route." } },
  { name: "Pismo Beach, CA", lat: 35.1428, lng: -120.6413, type: "c", nights: 6 },
  { name: "Carpinteria (Santa Barbara), CA", lat: 34.3989, lng: -119.5185, type: "c", nights: 5 },
  { name: "San Diego (Mission Bay), CA", lat: 32.7795, lng: -117.2147, type: "c", nights: 14, leaveRig: true },
  { name: "Desert Hot Springs (Palm Springs), CA", lat: 33.9611, lng: -116.5017, type: "c", nights: 14, extra: { note: "Sources chaudes ; parc Joshua Tree tout près." } },
  { name: "Quartzsite (BLM LTVA), AZ", lat: 33.6639, lng: -114.2299, type: "b", nights: 10, extra: { note: "Terres BLM : camping longue durée à petit prix (permis LTVA)." } },
  { name: "Mesa (Phoenix), AZ", lat: 33.4152, lng: -111.8315, type: "c", nights: 24 },
  { name: "Tucson, AZ", lat: 32.2226, lng: -110.9747, type: "c", nights: 21, extra: { note: "Parc national Saguaro, désert de Sonora." } },
  { name: "Willcox, AZ", lat: 32.2529, lng: -109.832, type: "b", nights: 1, extra: { note: "Route d’hiver : rouler le jour, vérifier la météo, réservoirs vides (risque de gel)." } },
  { name: "Las Cruces, NM", lat: 32.3199, lng: -106.7637, type: "b", nights: 1 },
  { name: "Van Horn, TX", lat: 31.0399, lng: -104.8308, type: "b", nights: 1 },
  { name: "Big Spring, TX", lat: 32.2504, lng: -101.4787, type: "b", nights: 1 },
  { name: "Abilene, TX", lat: 32.4487, lng: -99.7331, type: "b", nights: 1 },
  { name: "Fort Worth, TX", lat: 32.7555, lng: -97.3308, type: "b", nights: 1 },
  { name: "Texarkana, TX", lat: 33.4251, lng: -94.0477, type: "b", nights: 1 },
  { name: "Little Rock, AR", lat: 34.7465, lng: -92.2896, type: "b", nights: 1 },
  { name: "Memphis, TN", lat: 35.1495, lng: -90.049, type: "b", nights: 1 },
  { name: "Nashville, TN", lat: 36.1627, lng: -86.7816, type: "b", nights: 1 },
  { name: "Knoxville, TN", lat: 35.9606, lng: -83.9207, type: "b", nights: 1, extra: { note: "Route d’hiver : rouler le jour, vérifier la météo, réservoirs vides (risque de gel)." } },
  { name: "Bristol, VA", lat: 36.5951, lng: -82.1887, type: "b", nights: 1 },
  { name: "Roanoke, VA", lat: 37.271, lng: -79.9414, type: "b", nights: 1 },
  { name: "Winchester, VA", lat: 39.1857, lng: -78.1633, type: "b", nights: 1 },
  { name: "Scranton, PA", lat: 41.409, lng: -75.6624, type: "b", nights: 1, extra: { note: "Route d’hiver : rouler le jour, vérifier la météo, réservoirs vides (risque de gel)." } },
  { name: "Albany, NY", lat: 42.6526, lng: -73.7562, type: "b", nights: 1 },
  { name: "Plattsburgh, NY", lat: 44.6995, lng: -73.4529, type: "b", nights: 1, extra: { note: "Dernière nuit aux États-Unis : frontière de Lacolle le lendemain." } },
  { name: "Lévis, QC", lat: 46.803, lng: -71.1779, type: "b", nights: 1 },
  { name: "Charlevoix – chez André (Cheval enchanteur), QC", lat: 47.44, lng: -70.5, type: "dest", nights: 0, extra: { by: "2028-02-15", label: "Retour au Québec", note: "Position approximative : déplacer le point à l’adresse exacte." } },
];

// Ram 3500 2023 SRW Cummins 6.7 + Coachmen Chaparral 298RLS 2019
export const FUEL = { tankL: 189, threshold: 0.5, lPer100: 32, priceCad: 1.85 };
export const FUEL_KM = (FUEL.tankL * FUEL.threshold) / (FUEL.lPer100 / 100);   // ~295 km

// Gabarit de l'ensemble, utilisé par le profil poids lourd d'OpenRouteService
export const DEFAULT_VEHICLE = {
  heightM: 3.76,   // 12' 4"
  lengthM: 16.8,   // ~55' camion + fifth wheel
  widthM: 2.59,    // 8' 6"
  weightT: 9.0,    // ~19 600 lb combinés, à ajuster après pesée
};

export const TYPE_LABEL = { start: 'Départ', b: 'Boondock', c: 'Camping / parc', dest: 'Destination' };
