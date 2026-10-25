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
  { name: 'Yellowstone NP (Fishing Bridge), WY', lat: 44.56, lng: -110.37, type: 'dest', nights: 0 },
];

export const DEFAULT_START = '2027-06-01';
export const TARGET_ISO = '2027-07-01';   // arrivée visée à Yellowstone

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
