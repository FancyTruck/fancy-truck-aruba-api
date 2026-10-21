import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationPricelist, procedureStage } from '../src/commercialSafeguards.js';
test('GdC requires the verified company record and fiscal identity', () => {
  const company = {id:10, company_type:'company', vat:'IT02119200992', property_product_pricelist:[1,'Default']};
  assert.equal(quotationPricelist(company),13);
  assert.equal(quotationPricelist({...company,id:99}),1);
  assert.throws(()=>quotationPricelist({...company,id:99,property_product_pricelist:[13,'GdC']}));
  assert.throws(()=>quotationPricelist({...company,company_type:'person',property_product_pricelist:[13,'GdC']}));
  assert.throws(()=>quotationPricelist({...company,vat:'IT00000000000',property_product_pricelist:[13,'GdC']}));
  assert.throws(()=>quotationPricelist({id:99}));
});
test('incomplete requests use existing new-requests stage; ambiguity never picks arbitrarily', () => {
  const stages=[{id:1,name:'Nuove richieste'},{id:2,name:'Qualificate'}];
  assert.equal(procedureStage(stages,'DA_INTEGRARE').id,1);
  assert.equal(procedureStage(stages,'PRONTA_CONTROLLO_PIETRO').id,2);
  assert.equal(procedureStage([...stages,{id:3,name:'Da integrare'}],'DA_INTEGRARE').id,3);
  assert.throws(()=>procedureStage([...stages,{id:4,name:'Nuove richieste'}],'DA_INTEGRARE'));
  assert.throws(()=>procedureStage([],'DA_INTEGRARE'));
});
