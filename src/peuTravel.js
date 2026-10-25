import {logisticsConfig} from './logisticsRoutes.js';
import {verifiedGeocode} from './aiLogistics.js';
import {problem} from './peuCommon.js';
export const travelDefinition={effect:'read',parameters:{type:'object',properties:{destination:{type:'string',minLength:2,maxLength:500}},required:['destination'],additionalProperties:false}};
const coordinatesValid=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90;
const normalized=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function travelDestination(data,query){
 try{return {...verifiedGeocode(data,query),precision:'address'};}catch{}
 const candidates=(data.features||[]).filter(f=>f.properties?.country_a==='ITA'&&f.properties?.layer==='locality'&&f.properties?.confidence>=0.8&&normalized(f.properties.name||f.properties.locality)===normalized(query)&&coordinatesValid(f.geometry?.coordinates));
 const unique=[...new Map(candidates.map(f=>[f.geometry.coordinates.join(','),f])).values()];
 if(unique.length!==1)throw problem('destination_ambiguous_need_address',409);
 return {coordinates:unique[0].geometry.coordinates,label:unique[0].properties.label,precision:'city_reference'};
}
export async function travelFromDepot({destination},{env=process.env,fetcher=fetch,config=logisticsConfig()}={}){
 if(!env.ORS_API_KEY)throw problem('routing_unconfigured',503);
 let depot;try{depot=env.LOGISTICS_VERIFIED_DEPOT?JSON.parse(env.LOGISTICS_VERIFIED_DEPOT):config.verifiedDepot;}catch{}
 if(!depot||depot.address!==config.depotAddress||!depot.source||!coordinatesValid(depot.coordinates))throw problem('depot_coordinates_unverified',409);
 const request=async(url,body)=>{const r=await fetcher(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:env.ORS_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw problem('routing_provider_unavailable',503);return r.json();};
 const url=new URL('https://api.openrouteservice.org/geocode/search');url.searchParams.set('text',destination);url.searchParams.set('boundary.country','ITA');url.searchParams.set('size','5');
 const point=travelDestination(await request(url),destination);
 const data=await request('https://api.openrouteservice.org/v2/directions/driving-car',{coordinates:[depot.coordinates,point.coordinates],instructions:false});
 const route=data.routes?.[0],s=route?.summary;if(data.routes?.length!==1||!Number.isFinite(s?.distance)||s.distance<=0||!Number.isFinite(s?.duration)||s.duration<=0||(route.warnings||[]).some(w=>w.code!==1))throw problem('route_not_verified',502);
 return {ok:true,provider:'openrouteservice',origin:config.depotAddress,destination:point.label,destination_precision:point.precision,distance_km:s.distance/1000,duration_minutes:s.duration/60,profile:'driving-car',traffic_included:false,journey:'one_way',calculated_at:new Date().toISOString(),limitations:'Durata stimata senza traffico in tempo reale e senza soste. Percorso auto, non verifica accessibilità, ZTL o vincoli di camion e traini. Un riferimento città non è un indirizzo operativo né una base per fatturazione.'};
}
