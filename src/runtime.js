import path from 'node:path';

function booleanSetting(env, key, fallback) {
  if (env[key] === undefined) return fallback;
  if (!['true', 'false'].includes(env[key])) throw new Error(`${key}: usare true o false`);
  return env[key] === 'true';
}

export function runtimeConfig(env = process.env) {
  const environment = env.APP_ENV || 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('APP_ENV: usare development, test o production');
  }
  const readOnly = booleanSetting(env, 'READ_ONLY', true);
  const automationEnabled = booleanSetting(env, 'AUTOMATION_ENABLED', false);
  if (readOnly && automationEnabled) throw new Error('Automazione incompatibile con READ_ONLY=true');
  return Object.freeze({
    environment,
    readOnly,
    automationEnabled,
    startupChecks: booleanSetting(env, 'STARTUP_CHECKS', false),
    host: env.HOST || (environment === 'production' ? '0.0.0.0' : '127.0.0.1'),
    stateFile: env.STATE_FILE || (environment === 'production'
      ? '/var/data/fancy-truck-state.json'
      : path.resolve(`data/${environment}/state.json`)),
  });
}

export function assertWritable(config) {
  if (config.readOnly) {
    const error = new Error('Operazione bloccata: modalità sola lettura');
    error.code = 'READ_ONLY';
    throw error;
  }
}

export function assertOdooMethod(config, method) {
  // Allow only methods whose read semantics are used by this backend.
  if (!['search_read', 'search_count'].includes(method)) assertWritable(config);
}

export function readOnlyMiddleware(config) {
  return (req, res, next) => {
    if (config.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ ok: false, code: 'READ_ONLY', error: 'Modalità sola lettura' });
    }
    next();
  };
}
