import test from 'node:test';
import assert from 'node:assert/strict';
import {travelDestination,travelFromDepot} from '../src/peuTravel.js';
const city={features:[{geometry:{coordinates:[9.67,45.69]},properties:{country_a:'ITA',layer:'locality',confidence:1,name:'Bergamo',label:'Bergamo, Italia'}}]};
const config={depotAddress:'Depot verified',verifiedDepot:{address:'Depot verified',coordinates:[8.83,44.43],source:'operator pin'}};
test('verified city reference is distinct from a street address, ambiguity denied',()=>{
 assert.equal(travelDestination(city,'Bergamo').precision,'city_reference');
 assert.throws(()=>travelDestination({features:[...city.features,{...city.features[0],geometry:{coordinates:[10,46]}}]},'Bergamo'),/ambiguous/);
 assert.throws(()=>travelDestination(city,'Roma'),/ambiguous/);
});
test('routing uses configured warehouse and preserves distance AND duration',async()=>{
 let n=0;const result=await travelFromDepot({destination:'Bergamo'},{config,env:{ORS_API_KEY:'test'},fetcher:async(u,o)=>{if(++n===1)return Response.json(city);assert.deepEqual(JSON.parse(o.body).coordinates,[[8.83,44.43],[9.67,45.69]]);return Response.json({routes:[{summary:{distance:237500,duration:10860}}]});}});
 assert.equal(result.distance_km,237.5);assert.equal(result.duration_minutes,181);assert.equal(result.traffic_included,false);
});
test('missing duration, provider errors and unverified depot do not yield guessed estimates',async()=>{
 await assert.rejects(travelFromDepot({destination:'Bergamo'},{config:{},env:{ORS_API_KEY:'test'}}),/depot_coordinates_unverified/);
 let n=0;await assert.rejects(travelFromDepot({destination:'Bergamo'},{config,env:{ORS_API_KEY:'test'},fetcher:async()=>Response.json(++n===1?city:{routes:[{summary:{distance:230000}}]})}),/route_not_verified/);
});
