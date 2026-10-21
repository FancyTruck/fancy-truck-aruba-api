// Applies only to the standard Logistica product (7), not driver or towing.
// Distances must be established by the operator/routing system, not inferred
// from a city name. Odoo owns the monetary price, taxes and discounts.
export function standardLogisticsLines({ deliveryKm, collectionKm }) {
  const legs = [['Consegna', deliveryKm], ['Ritiro', collectionKm]];
  return legs.map(([label, km]) => {
    if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) {
      throw new Error(`${label}: chilometri verificati mancanti o non validi`);
    }
    // Odoo quantities use two decimal places; retain raw routing km in the label.
    const billed = Math.max(100, Math.round(km * 100) / 100);
    return [0, 0, { product_id: 7, is_rental: false,
      product_uom_qty: billed,
      name: `Logistica — ${label}: ${km} km; ${billed} km fatturabili (minimo 100 km per servizio).` }];
  });
}
