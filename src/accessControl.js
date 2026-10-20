import crypto from 'node:crypto';
function matches(supplied, expected) {
  if (!expected) return false;
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function accessControl(env) {
  const configured = [env.API_TOKEN, env.REVIEW_READ_TOKEN, env.REVIEW_WRITE_TOKEN].filter(Boolean);
  if (new Set(configured).size !== configured.length) throw new Error('Usare chiavi diverse per i diversi ruoli');
  return (req, res, next) => {
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const role = matches(supplied, env.API_TOKEN) ? 'admin'
      : matches(supplied, env.REVIEW_WRITE_TOKEN) ? 'reviewer'
        : matches(supplied, env.REVIEW_READ_TOKEN) ? 'reader' : null;
    if (!role) return res.status(401).json({ ok: false, error: 'Non autorizzato' });
    const path = req.originalUrl.split('?')[0];
    const list = req.method === 'GET' && path === '/v1/classification-reviews';
    const resolve = req.method === 'POST' && /^\/v1\/classification-reviews\/[a-f0-9]{64}\/resolve$/.test(path);
    if (role !== 'admin' && !list && !(role === 'reviewer' && resolve)) {
      return res.status(403).json({ ok: false, error: 'Operazione non consentita per questo ruolo' });
    }
    req.accessRole = role;
    next();
  };
}
