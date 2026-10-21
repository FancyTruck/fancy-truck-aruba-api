import {problem} from './peuCommon.js';
export function validateSchema(schema,value,depth=0){
 if(depth>12||!schema||typeof schema!=='object'||schema.$ref)throw problem('unsupported_capability_schema',502);
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 if(schema.type&&!types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===t))throw problem('parameter_type_mismatch');
 if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))throw problem('parameter_enum_mismatch');
 if(typeof value==='string'){if(value.length>(schema.maxLength??10000)||value.length<(schema.minLength??0))throw problem('parameter_length');if(schema.pattern){if(schema.pattern.length>200)throw problem('unsupported_capability_schema');if(!new RegExp(schema.pattern).test(value))throw problem('parameter_pattern');}}
 if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw problem('parameter_range');
 if(Array.isArray(value)){if(value.length>(schema.maxItems??1000)||value.length<(schema.minItems??0))throw problem('parameter_array_size');for(const item of value)if(schema.items)validateSchema(schema.items,item,depth+1);}
 else if(value&&typeof value==='object'){for(const k of schema.required||[])if(!Object.hasOwn(value,k))throw problem('parameter_required');for(const [k,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw problem('invalid_parameter');if(schema.properties?.[k])validateSchema(schema.properties[k],v,depth+1);else if(schema.additionalProperties===false)throw problem('unexpected_parameter');}}
 return true;
}

