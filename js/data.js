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

// Suite proposée après Yellowstone (juillet → mi-septembre) : Glacier, Stampede, Rocheuses,
// Colombie-Britannique et île de Vancouver. extra.ferry = tronçon d'arrivée en traversier.
export const PHASE2 = [
  { name: 'Livingston, MT', lat: 45.6625, lng: -110.5605, type: 'b', nights: 1 },
  { name: 'Helena, MT', lat: 46.5891, lng: -112.0391, type: 'c', nights: 2, extra: { note: 'Croisière Gates of the Mountains : le paysage sans effort.' } },
  { name: 'Choteau, MT', lat: 47.8124, lng: -112.1836, type: 'b', nights: 1, extra: { note: 'Halte pour couper Helena → Glacier (420 km).' } },
  { name: 'St. Mary – Glacier NP (côté est), MT', lat: 48.7459, lng: -113.4400, type: 'c', nights: 3, leaveRig: true,
    extra: { note: 'Going-to-the-Sun Road interdite au-delà de 21 pi : camion seul ou navette.' } },
  { name: 'West Glacier – Glacier NP (côté ouest), MT', lat: 48.5050, lng: -113.9870, type: 'c', nights: 2, leaveRig: true,
    extra: { note: 'Trail of the Cedars (facile, plat).' } },
  { name: 'Parc national des Lacs-Waterton, AB', lat: 49.0485, lng: -113.9105, type: 'c', nights: 1,
    extra: { note: 'Frontière par Chief Mountain (poste saisonnier) ou Carway.' } },
  { name: 'Calgary (Stampede), AB', lat: 51.0866, lng: -114.2350, type: 'c', nights: 4, leaveRig: true,
    extra: { from: '2027-07-09', by: '2027-07-15', label: 'Stampede du 9 au 18 juillet', note: 'Campings rares pendant le Stampede : réserver dès l’ouverture.' } },
  { name: 'Banff (Tunnel Mountain), AB', lat: 51.1890, lng: -115.5390, type: 'c', nights: 3, leaveRig: true },
  { name: 'Lake Louise, AB', lat: 51.4170, lng: -116.1790, type: 'c', nights: 2, leaveRig: true,
    extra: { note: 'Excursion dans Yoho (lac Emerald) en camion seul.' } },
  { name: 'Jasper, AB', lat: 52.8530, lng: -118.0790, type: 'c', nights: 3, leaveRig: true,
    extra: { note: 'Par la promenade des Glaciers ; vérifier les campings rouverts après les feux de 2024.' } },
  { name: 'Valemount, BC', lat: 52.8310, lng: -119.2650, type: 'b', nights: 1, extra: { note: 'Halte au mont Robson en route.' } },
  { name: 'Clearwater (Wells Gray), BC', lat: 51.6510, lng: -120.0380, type: 'c', nights: 2, extra: { note: 'Chutes Helmcken et Dawson : belvédères près des stationnements.' } },
  { name: 'Kamloops, BC', lat: 50.6745, lng: -120.3273, type: 'b', nights: 1 },
  { name: 'Kelowna (Okanagan), BC', lat: 49.8880, lng: -119.4960, type: 'c', nights: 3 },
  { name: 'Hope, BC', lat: 49.3830, lng: -121.4420, type: 'b', nights: 1, extra: { note: 'Tunnels Othello : sentier plat, idéal pour le genou.' } },
  { name: 'Vancouver (Burnaby), BC', lat: 49.2530, lng: -122.9520, type: 'c', nights: 3, leaveRig: true },
  { name: 'Victoria (Goldstream), BC', lat: 48.4740, lng: -123.5480, type: 'c', nights: 3,
    extra: { ferry: true, note: 'Traversier BC Ferries Tsawwassen → Swartz Bay (~1 h 35) : réserver, tarif selon la longueur.' } },
  { name: 'Pacific Rim – Ucluelet / Tofino, BC', lat: 49.0590, lng: -125.7230, type: 'c', nights: 4,
    extra: { note: 'Route 4 sinueuse (Kennedy Hill) : rouler lentement. Camping Green Point (Parcs Canada).' } },
  { name: 'Nanaimo – retour sur le continent, BC', lat: 49.1930, lng: -123.9550, type: 'dest', nights: 0,
    extra: { note: 'Traversier Departure Bay → Horseshoe Bay. Suite du voyage à planifier.' } },
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
