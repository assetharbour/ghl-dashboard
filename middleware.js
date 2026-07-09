import { next } from '@vercel/functions'

// Shown in the browser's native Basic Auth popup title.
const REALM = 'Asset Harbour Reporting Dashboard'

/**
 * HTTP Basic Auth gate — Vercel Routing Middleware.
 *
 * This runs at Vercel's edge BEFORE any request is served, for every route
 * in this project (see config.matcher below), including the initial HTML
 * shell and every JS/CSS asset. That's deliberate: a client-side React
 * password screen would still ship the full app bundle — and the
 * VITE_SHEETS_API_KEY baked into it — to the browser before any check ran,
 * making it trivially bypassable (read the network tab, or just disable
 * JS). Gating here means an unauthenticated request never receives any
 * app code or data at all.
 *
 * Credentials are read from env vars (DASHBOARD_AUTH_USER /
 * DASHBOARD_AUTH_PASS, set in Vercel Project Settings), never hardcoded.
 */
export default function middleware(request) {
  if (isAuthorized(request.headers.get('authorization'))) {
    return next()
  }

  // No/invalid credentials: 401 + WWW-Authenticate makes the browser show
  // its native (non-custom-stylable) login popup and retry with creds.
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
  })
}

function isAuthorized(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return false

  let decoded
  try {
    decoded = atob(authHeader.slice('Basic '.length))
  } catch {
    return false
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex === -1) return false

  const user = decoded.slice(0, separatorIndex)
  const pass = decoded.slice(separatorIndex + 1)

  return user === process.env.DASHBOARD_AUTH_USER && pass === process.env.DASHBOARD_AUTH_PASS
}

export const config = {
  // Every route — the whole app (HTML shell, JS/CSS bundles, everything)
  // sits behind this gate, not just the initial page load.
  matcher: '/(.*)',
}
