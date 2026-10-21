import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLogisticsAddresses, prepareRentalLogistics, verifiedGeocode, routeAddresses } from '../src/aiLogistics.js';
const env = { OPENAI_API_KEY:'test', OPENAI_MODEL:'test', ORS_API_KEY:'test', AI_LOGISTICS_ENABLED:'true' };
const addr = 'Via Test 10, Genova';
const data = { delivery:addr, collection:null, samePlaceEvidence:'Ritiro stesso indirizzo', manualTransportEvidence:null };
const reply = data => ({ok:true,json:async()=>data});
const ai = data => async()=>reply({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const feature = (coordinates=[8,44], overrides={}) => ({ geometry:{coordinates}, properties:{layer:'address',country_a:'ITA',confidence:1,housenumber:'10',street:'Via Test',locality:'Genova',label:addr,...overrides} });
test('AI extracts only literal address evidence and uses explicit shared pickup',async()=>{
 const value=await extractLogisticsAddresses(addr+'. Ritiro stesso indirizzo',{env,fetchImpl:ai(data)});
 assert.equal(value.collection,addr);
 await assert.rejects(extractLogisticsAddresses('Consegna Milano',{env,fetchImpl:ai(data)}),/EVIDENCE/);
});
test('missing pickup is asked rather than inferred; unavailable API never generates prices',async()=>{
 const result=await prepareRentalLogistics(addr,{env,fetchImpl:ai({...data,samePlaceEvidence:null})});
 assert.equal(result.status,'MISSING_ADDRESSES');assert.equal(result.missing.length,1);assert.equal(result.lines.length,0);
 const failed=await prepareRentalLogistics(addr,{env,fetchImpl:async()=>({ok:false,status:429})});
 assert.equal(failed.status,'MANUAL_REVIEW');assert.equal(failed.lines.length,0);
});
test('self pickup or special transport does not get standard logistics',async()=>{
 const result=await prepareRentalLogistics('Ritiro io',{env,fetchImpl:ai({delivery:null,collection:null,samePlaceEvidence:null,manualTransportEvidence:'Ritiro io'})});
 assert.equal(result.status,'MANUAL_TRANSPORT');assert.equal(result.lines.length,0);
});
test('geocoder refuses city, ambiguous results, wrong city and house number',()=>{
 assert.deepEqual(verifiedGeocode({features:[feature()]},addr).coordinates,[8,44]);
 for(const features of [[feature([8,44],{layer:'locality'})],[feature(),feature([9,45])],[feature([8,44],{locality:'Milano'})],[feature([8,44],{housenumber:'11'})]]) assert.throws(()=>verifiedGeocode({features},addr));
});
test('four independent route legs are summed and minima separate; no price supplied',async()=>{
 let directions=0;
 const config={depotAddress:'Via Test 10, Genova'};
 const fetchImpl=async(url,options)=>{
 if(String(url).includes('openai.com')) return ai(data)();
 if(String(url).includes('geocode')) return reply({features:[feature()]});
 assert.deepEqual(JSON.parse(options.body).coordinates,[[8,44],[8,44]]);
 return reply({routes:[{summary:{distance:[40000,45000,80000,90000][directions++]}}]});
 };
 const result=await prepareRentalLogistics(addr+'. Ritiro stesso indirizzo',{env,fetchImpl,config});
 assert.equal(result.status,'ROUTED_FOR_REVIEW');assert.equal(directions,4);
 assert.deepEqual(result.lines.map(l=>l[2].product_uom_qty),[100,170]);
 assert(result.lines.every(l=>!('price_unit' in l[2])));
});
test('unrecognized routing warnings block billing',async()=>{
 const fetchImpl=async url=>String(url).includes('geocode')?reply({features:[feature()]}):reply({routes:[{summary:{distance:1000},warnings:[{code:3}]}]});
 await assert.rejects(routeAddresses({delivery:addr,collection:addr},{env,fetchImpl,config:{depotAddress:addr}}),/ROUTE_NOT_VERIFIED/);
});

test('house suffix is significant and warehouse override cannot survive an address change',async()=>{
 assert.throws(()=>verifiedGeocode({features:[feature()]},'Via Test 10R, Genova'));
 const result=await prepareRentalLogistics(addr+'. Ritiro stesso indirizzo',{env:{...env,LOGISTICS_VERIFIED_DEPOT:JSON.stringify({address:'Old warehouse',coordinates:[8,44],source:'operator'})},config:{depotAddress:addr},fetchImpl:ai(data)});
 assert.equal(result.status,'MANUAL_REVIEW');assert.equal(result.reason,'INVALID_DEPOT_OVERRIDE');
});

test('access restriction warning remains attached to the proposed route for human review',async()=>{
 const fetchImpl=async url=>String(url).includes('geocode')?reply({features:[feature()]}):reply({routes:[{summary:{distance:1000},warnings:[{code:1,message:'There may be restrictions on some roads'}]}]});
 const routes=await routeAddresses({delivery:addr,collection:addr},{env,fetchImpl,config:{depotAddress:addr}});
 assert.equal(routes.delivery.outboundWarnings[0].code,1);assert.equal(routes.collection.returnWarnings[0].code,1);
});
