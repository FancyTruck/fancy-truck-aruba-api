import fs from 'node:fs';
const defaultPath = new URL('../config/logistics.json', import.meta.url);
export function logisticsConfig() {
  const config = JSON.parse(fs.readFileSync(process.env.LOGISTICS_CONFIG_FILE || defaultPath, 'utf8'));
  const depotAddress = process.env.LOGISTICS_DEPOT_ADDRESS || config.depotAddress;
  if (typeof depotAddress !== 'string' || !depotAddress.trim()) throw Error('Deposito non configurato');
  if (config.includeReturnJourney !== true || config.minimumKmPerService !== 100 || config.standardProductId !== 7) {
    throw Error('Configurazione logistica non compatibile con la regola approvata');
  }
  return { ...config, depotAddress: depotAddress.trim() };
}
// Route distances must come from a verified routing result/operator. Do not
// assume equal distances on both legs (one-way roads can change the return).
export function logisticsDistancesFromRoutes(routes, config = logisticsConfig()) {
  if (routes?.depotAddress !== config.depotAddress) throw Error('Percorso da ricalcolare per il deposito attuale');
  const total = (service, label) => {
    for (const leg of ['outboundKm', 'returnKm']) {
      if (typeof service?.[leg] !== 'number' || !Number.isFinite(service[leg]) || service[leg] < 0) {
        throw Error(`${label}: mancano chilometri verificati di andata e ritorno`);
      }
    }
    const km = service.outboundKm + service.returnKm;
    if (!Number.isFinite(km)) throw Error('Distanza non valida');
    return km;
  };
  return { deliveryKm: total(routes.delivery, 'Consegna'), collectionKm: total(routes.collection, 'Ritiro') };
}
