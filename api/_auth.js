import { timingSafeEqual } from 'node:crypto'

// Basic Auth check shared by the API functions. Same credentials as middleware.js, re-checked inside each
// function so an endpoint stays locked even if the middleware matcher is ever changed.

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function isAuthorized(header) {
  const user = process.env.DASHBOARD_AUTH_USER
  const pass = process.env.DASHBOARD_AUTH_PASS
  if (!user || !pass || !header || !header.startsWith('Basic ')) return false
  let decoded
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  } catch {
    return false
  }
  const i = decoded.indexOf(':')
  if (i === -1) return false
  return safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)
}
