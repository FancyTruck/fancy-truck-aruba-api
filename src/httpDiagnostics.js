// Record actionable failures without URLs, query strings, request bodies,
// headers, customer identifiers or provider exception messages.
export function httpFailureDiagnostics({ log = value => console.error(JSON.stringify(value)),
  clock = () => performance.now(), memory = () => process.memoryUsage().rss } = {}) {
  return (req, res, next) => {
    const started = clock();
    res.once('finish', () => {
      if (res.statusCode !== 413 && res.statusCode < 500) return;
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)
        ? req.method : 'OTHER';
      try {
        log({ event: 'http_request_failed', http_status: res.statusCode, method, route,
          duration_ms: Math.max(0, Math.round(clock() - started)), rss_bytes: memory() });
      } catch {
        // Observability must not turn an already completed response into a failure.
      }
    });
    next();
  };
}
