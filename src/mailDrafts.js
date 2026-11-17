import {hash,problem} from './peuCommon.js';
export function mailDrafts(state,{since,action_id,after='',limit=50}){
 if(!Number.isFinite(Date.parse(since))||!Number.isInteger(limit)||limit<1||limit>50)throw problem('invalid_draft_query');
 const rows=Object.values(state.actions||{}).filter(a=>a.type==='SEND_EMAIL'&&a.status==='PENDING_APPROVAL'&&['hello','pietro'].includes(a.payload?.account)&&(action_id?a.id===action_id:Date.parse(a.created_at)>=Date.parse(since))).sort((a,b)=>a.id.localeCompare(b.id)).filter(a=>a.id>after);
 const page=rows.slice(0,limit).map(a=>({action_id:a.id,created_at:a.created_at,payload_hash:hash(a.payload),account:a.payload.account,to:a.payload.to,subject:a.payload.subject,text:a.payload.text||null,html:a.payload.html||null}));
 return {ok:true,drafts:page,next_after:rows.length>limit?page.at(-1).action_id:null};
}
