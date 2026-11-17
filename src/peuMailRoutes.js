import {ArubaService} from './peuMailService.js';
import {openMailDb,problem} from './peuMailDb.js';
import {join,dirname} from 'node:path';
// Deliberately no SMTP, Odoo writes, approval or execution routes.
export function mountPeuMail(app,{withImap,parse,stateFile}) {
  const db=openMailDb(join(dirname(stateFile),'peu-aruba.sqlite'));
  const service=new ArubaService({db,withImap,parse,accounts:['pietro','hello']});
  const syncing=new Map(),finished=new Map();
  const wrap=fn=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      if(!['pietro','hello'].includes(req.params.account))throw problem('account_not_authorized',403);
      res.json(await fn(req));
    }catch(e){res.status(e.status||502).json({error:e.code&&/^[a-z_]+$/.test(e.code)?e.code:'aruba_operation_failed'});}
  };
  const folder=req=>{const value=req.body?.folder||req.query.folder;if(value!=='INBOX')throw problem('folder_not_authorized',403);return value;};
  app.get('/v1/peu/aruba/:account/folders',wrap(async req=>({folders:(await service.folders(req.params.account)).folders.filter(f=>f.path==='INBOX')})));
  app.post('/v1/peu/aruba/:account/sync',wrap(async req=>{
    folder(req); const account=req.params.account;
    if(finished.has(account)){const result=finished.get(account);finished.delete(account);return result;}
    if(!syncing.has(account)) syncing.set(account,service.sync(account,'INBOX').then(result=>{console.log(JSON.stringify({event:'peu_aruba_sync',account,status:result.status,new_messages:result.new_messages}));finished.set(account,result);return result;}).finally(()=>{syncing.delete(account);}));
    // The initial history import outlives an HTTP request. Keep one job and
    // expose partial coverage instead of repeatedly timing out or duplicating it.
    let timer;
    try{const result=await Promise.race([syncing.get(account),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'syncing',coverage:'backfill_in_progress'}),8000);})]);if(result.status!=='syncing')finished.delete(account);return result;}
    finally{clearTimeout(timer);}
  }));
  app.get('/v1/peu/aruba/:account/messages',wrap(req=>({messages:service.messages(req.params.account,folder(req))})));
  app.get('/v1/peu/aruba/:account/thread',wrap(req=>service.thread(req.params.account,String(req.query.thread||''))));
  app.get('/v1/peu/aruba/:account/attachment',wrap(req=>{
    const uid=Number(req.query.uid),index=Number(req.query.index);
    if(!Number.isSafeInteger(uid)||uid<1||!Number.isSafeInteger(index)||index<0)throw problem('invalid_attachment');
    return service.attachment(req.params.account,folder(req),String(req.query.validity),uid,index);
  }));
  return db;
}
