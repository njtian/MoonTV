export function isRemoteEnabled(): boolean {
  const storage = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const enabled = process.env.NEXT_PUBLIC_ENABLE_REMOTE === 'true';
  return enabled && (storage === 'redis' || storage === 'upstash');
}

export function isAllowedOrigin(request: Request): boolean {
  // Configurable origin check for remote APIs
  // REMOTE_ORIGIN_CHECK: 'off' | 'loopback' | 'strict'
  const checkMode = (process.env.REMOTE_ORIGIN_CHECK || 'loopback').toLowerCase();
  if (checkMode === 'off' || process.env.NODE_ENV !== 'production') return true;

  // Basic CSRF mitigation: require same-origin for POSTs by default
  // Loopback ergonomics: treat localhost/127.0.0.1/::1 as equivalent if same scheme+port when in 'loopback' mode
  try {
    const originHeader = request.headers.get('origin');
    if (!originHeader) return true; // allow non-browser clients
    const requestUrl = new URL(request.url);
    if (originHeader === requestUrl.origin) return true;

    if (checkMode === 'loopback') {
      // Allow loopback equivalence for local setups behind proxies
      try {
        const originUrl = new URL(originHeader);
        const loopbacks = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
        const bothHttp = originUrl.protocol === requestUrl.protocol;
        const samePort =
          (originUrl.port || defaultPort(originUrl.protocol)) ===
          (requestUrl.port || defaultPort(requestUrl.protocol));
        const bothLoopback =
          loopbacks.has(originUrl.hostname) &&
          loopbacks.has(requestUrl.hostname);
        if (bothHttp && samePort && bothLoopback) return true;
      } catch {
        // ignore parse error and fall through
      }
    }

    return false;
  } catch {
    return false;
  }
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}
