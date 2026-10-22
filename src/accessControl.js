import crypto from 'node:crypto';
function matches(supplied, expected) {
  if (!expected) return false;
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function accessControl(env) {
  const keys = {peu:env.PEU_ACCESS_TOKEN, peuInternal:env.PEU_INTERNAL_TOKEN, admin:env.API_TOKEN, reader:env.REVIEW_READ_TOKEN, reviewer:env.REVIEW_WRITE_TOKEN,
    automation:env.AUTOMATION_TOKEN, approver:env.APPROVER_TOKEN, executor:env.EXECUTOR_TOKEN};
  const configured = Object.values(keys).filter(Boolean);
  if (new Set(configured).size !== configured.length) throw new Error('Usare chiavi diverse per i diversi ruoli');
  const strict = env.SEPARATE_APPROVAL_ROLES === 'true';
  if (strict && (!keys.approver || !keys.executor)) throw new Error('Ruoli approvazione/esecuzione non configurati');
  return (req, res, next) => {
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const role = Object.keys(keys).find(name => matches(supplied, keys[name]));
    if (!role) return res.status(401).json({ok:false,error:'Non autorizzato'});
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
    const approval = req.method==='POST' && /^\/v1\/approvals\/[^/]+\/(command|confirm)$/.test(path);
    const execution = req.method==='POST' && /^\/v1\/actions\/[^/]+\/execute$/.test(path);
    const list = req.method==='GET' && path==='/v1/classification-reviews';
    const briefing = req.method==='GET' && path==='/v1/briefing';
    const actions = req.method==='GET' && path==='/v1/automation/status';
    const resolve = req.method==='POST' && /^\/v1\/classification-reviews\/[a-f0-9]{64}\/resolve$/.test(path);
    let allowed = role==='admin';
    if(role==='peu') allowed = (req.method==='GET' && /^\/v1\/peu\/aruba\/pietro\/(folders|messages|thread|attachment)$/.test(path)) || (req.method==='POST' && path==='/v1/peu/aruba/pietro/sync');
    if(role==='peu') allowed ||= (req.method==='GET' && (path==='/v1/peu/capabilities'||/^\/v1\/peu\/operations\/[^/]+$/.test(path)||path==='/v1/odoo/contacts/search')) || (req.method==='POST'&&path==='/v1/peu/commands');
    if(role==='peu') allowed ||= (req.method==='GET'&&path==='/v1/peu/whatsapp/events')||(req.method==='POST'&&path==='/v1/peu/whatsapp/reply');
    if(role==='peuInternal') allowed = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) && ((req.method==='GET'&&['/v1/odoo/contacts/search','/v1/odoo/products/search','/v1/odoo/crm/stages'].includes(path)) || (req.method==='POST'&&['/v1/odoo/crm/leads','/v1/odoo/sales/drafts'].includes(path)));
    if (strict && (approval || execution)) allowed = false;
    if (['reader','reviewer'].includes(role)) allowed = list || briefing || (role==='reviewer' && resolve);
    if (role==='automation') allowed = (req.method==='POST' && path==='/v1/automation/run') || briefing;
    if (role==='approver') allowed = approval || actions || briefing;
    if (role==='executor') allowed = execution || actions;
    if (!allowed) return res.status(403).json({ok:false,error:'Operazione non consentita per questo ruolo'});
    req.accessRole = role;
    next();
  };
}

