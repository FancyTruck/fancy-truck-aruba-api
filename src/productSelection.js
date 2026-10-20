import { VERIFIED_ODOO_MODELS } from './verifiedOdooModels.js';
import { VEHICLE_CATALOGUE, genericVehicleFamily } from './vehicleCatalogue.js';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function selectExactProduct(products, requested, rental = false) {
  const name = normalize(requested);
  if (!name || genericVehicleFamily(requested)) return null;
  const model = VEHICLE_CATALOGUE.find(([label, aliases]) => [label, ...aliases].some(alias => normalize(alias) === name));
  const allowed = new Set((model ? [model[0], ...model[1]] : [requested]).map(normalize));
  const matches = products.filter(product => product.sale_ok && (!rental || product.rent_ok)
    && (allowed.has(normalize(product.name)) || VERIFIED_ODOO_MODELS.some(verified =>
      normalize(verified.model) === normalize(model?.[0] || requested) && verified.productId === product.id
      && normalize(verified.productName) === normalize(product.name))));
  return matches.length === 1 ? matches[0] : null;
}
export function draftProductLine(product, isRental, text) {
  // A product list price is not a duration-based rental tariff.
  if (product && !isRental && Number.isFinite(Number(product.list_price)) && Number(product.list_price) > 0) {
    return [0, 0, { product_id: product.id, name: product.name, product_uom_qty: 1, price_unit: Number(product.list_price) }];
  }
  return [0, 0, { display_type: 'line_note', name: `${product ? `Mezzo individuato: ${product.name}. ` : ''}${isRental ? 'Tariffa noleggio da verificare per periodo e durata. ' : 'Prodotto e prezzo da verificare. '}Richiesta: ${String(text).slice(0, 3000)}` }];
}
