// Observed through sales-order detail and the user's read-only catalogue export on 2026-10-21.
// Rental requires rent_ok; sales require sale_ok. Exact identity is checked at selection.
// No rental tariff is inferred from a historical quote.
export const VERIFIED_ODOO_MODELS = [
  { model: 'Airstream', productId: 40, productName: 'Airstream Replica 4m XA855XY', orders: [327, 325] },
  { model: 'Horse Trailer Legno', productId: 45, productName: 'Horse Trailer Legno VC010026', orders: [325] },
  { model: 'Horse Trailer Vintage', productId: 46, productName: 'Horse Trailer Vintage GE030793', orders: [325] },
  { model: 'Ape Car', productId: 60, productName: 'Piaggio Ape Classic Lineare BJ49780', orders: [325] },
  { model: 'American School Bus', productId: 50, productName: 'American Schoolbus GC192HZ' },
  { model: 'Cargo Bike', productId: 3, productName: 'Cargo e-bike' },
  { model: 'Citroën Type H', productId: 163, productName: 'Citroen Type H EX826XR' },
  { model: 'Citroën Type H', productId: 14, productName: 'Citroen Type H ZB896AE' },
  { model: 'Ducato', productId: 35, productName: 'Fiat Ducato GT045YM' },
  { model: 'Food Cart', productId: 181, productName: 'Food Cart' },
  { model: 'Framo', productId: 51, productName: 'Framo ZB963AE' },
  { model: 'Porter', productId: 15, productName: 'Piaggio Porter Conchiglia ZA060TK' },
  { model: 'Renault Estafette', productId: 52, productName: 'Renault Estafette ZA381TG' },
  { model: 'Volkswagen Bulli', productId: 31, productName: 'Volkswagen T1 ZA201RN' },
];
