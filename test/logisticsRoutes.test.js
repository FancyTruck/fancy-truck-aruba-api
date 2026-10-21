import test from 'node:test';
import assert from 'node:assert/strict';
import {logisticsConfig,logisticsDistancesFromRoutes} from '../src/logisticsRoutes.js';
import {standardLogisticsLines} from '../src/standardLogistics.js';
const config={depotAddress:'Via Rollino 69R, 16154 Genova, Italia'};
const routes=(delivery,collection)=>({depotAddress:config.depotAddress,delivery,collection});
test('both journeys count; minimum applies to each service total, not each leg',()=>{
  const distances=logisticsDistancesFromRoutes(routes({outboundKm:40,returnKm:45},{outboundKm:75,returnKm:80}),config);
  assert.deepEqual(distances,{deliveryKm:85,collectionKm:155});
  assert.deepEqual(standardLogisticsLines(distances).map(line=>line[2].product_uom_qty),[100,155]);
});
test('warehouse move invalidates distances based on the old departure address',()=>{
  assert.throws(()=>logisticsDistancesFromRoutes(routes({outboundKm:50,returnKm:50},{outboundKm:50,returnKm:50}),{depotAddress:'Nuovo magazzino'}));
});
test('missing return is not replaced by an assumed symmetric journey',()=>{
  assert.throws(()=>logisticsDistancesFromRoutes(routes({outboundKm:100},{outboundKm:50,returnKm:50}),config));
});
test('default warehouse configuration is readable and includes return journeys',()=>{
  const saved=logisticsConfig();assert.equal(saved.includeReturnJourney,true);assert.equal(saved.minimumKmPerService,100);
});
