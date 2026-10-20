// Observed through read-only sales-order detail on 2026-10-21.
// Current sale_ok/rent_ok and exact identity must still be checked at selection.
// No rental tariff is inferred from a historical quote.
export const VERIFIED_ODOO_MODELS = [
  { model: 'Airstream', productId: 40, productName: 'Airstream Replica 4m XA855XY', orders: [327, 325] },
  { model: 'Horse Trailer Legno', productId: 45, productName: 'Horse Trailer Legno VC010026', orders: [325] },
  { model: 'Horse Trailer Vintage', productId: 46, productName: 'Horse Trailer Vintage GE030793', orders: [325] },
  { model: 'Ape Car', productId: 60, productName: 'Piaggio Ape Classic Lineare BJ49780', orders: [325] },
];
