// Verified against the public catalogue on 2026-10-21; not live availability.
export const CATALOGUE_URL = 'https://www.fancytruck.agency/truck/';
export const VEHICLE_CATALOGUE = [
  ['Airstream', ['airstream']],
  ['Horse Trailer Vintage', ['horse trailer vintage']],
  ['Cargo Bike', ['cargo bike']],
  ['Ape Car', ['ape car', 'ape']],
  ['Citroën Type H', ['citroen type h', 'citroen hy', 'citroen h']],
  ['Volkswagen Bulli', ['volkswagen bulli', 'bulli', 'vw t1']],
  ['American School Bus', ['american school bus', 'school bus', 'schoolbus']],
  ['Renault Estafette', ['renault estafette', 'estafette']],
  ['Framo', ['framo']],
  ['Ducato', ['ducato']],
  ['Porter', ['porter']],
  ['Food Cart', ['food cart']],
];
function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function catalogueModelsIn(text) {
  const value = ` ${normalize(text)} `;
  return VEHICLE_CATALOGUE.filter(([, aliases]) => aliases.some(alias => value.includes(` ${normalize(alias)} `))).map(([name]) => name);
}

// User-confirmed families: a generic name does not select a particular vehicle.
export function genericVehicleFamily(text) {
  const value = normalize(text);
  if (/\b(?:horse trailer|horsebox)\b/.test(value) && !/\b(?:vintage|legno)\b/.test(value)) return 'Horse Trailer';
  if (/\bape(?: car)?\b/.test(value) && !/\b(?:classic|lineare|calessino|piaggio ape .+)\b/.test(value)) return 'Ape';
  return null;
}
