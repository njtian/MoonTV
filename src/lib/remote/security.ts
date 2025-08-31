export function isRemoteEnabled(): boolean {
  const storage = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const enabled = process.env.NEXT_PUBLIC_ENABLE_REMOTE === 'true';
  return enabled && (storage === 'redis' || storage === 'upstash');
}

export function isAllowedOrigin(request: Request): boolean {
  // Basic CSRF mitigation: require same-origin for POSTs by default
  try {
    const origin = request.headers.get('origin');
    if (!origin) return true; // allow non-browser clients
    const url = new URL(request.url);
    return origin === url.origin;
  } catch {
    return false;
  }
}
