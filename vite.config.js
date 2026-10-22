import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// LOCAL DEVELOPMENT ONLY (`apply: 'serve'`: this plugin is not part of `vite build` and never ships).
// `npm run dev` does not run Vercel's api/ functions, so this serves /api/leads locally by loading the real
// api/leads.js handler, which reads the REAL private Google sheet (read-only) with the service account.
//   * Credentials: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID come from the environment, .env.local, or the
//     sibling ghl-reporting-sync/.env (same sheet, same account). They are never copied anywhere.
//   * No Basic Auth prompt locally: the dev server only listens on this machine, so the handler's own check is
//     satisfied with the local credentials. Production keeps the real credentials and the edge middleware.
//   * The audit tabs (Appointments, Flags, Field_Locks) do not exist in the sheet until FIELD_AUDIT runs, so if
//     ghl-dashboard/.local-audit.json exists (made by ghl-reporting-sync/scripts/local_audit_snapshot.py from live
//     GHL, read-only) its tables are shown in their place.
function parseEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i <= 0 || line.trim().startsWith('#')) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/s, '$2')
  }
  return out
}

function localApi() {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/leads', async (req, res) => {
        const send = (code, body) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          const env = { ...parseEnvFile(resolve('../ghl-reporting-sync/.env')), ...parseEnvFile(resolve('.env.local')), ...loadEnv('development', process.cwd(), '') }
          for (const key of ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEET_ID']) {
            if (!process.env[key] && env[key]) process.env[key] = env[key]
          }
          if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_SHEET_ID) {
            return send(500, { error: 'local_api_missing_google_credentials' })
          }
          process.env.DASHBOARD_AUTH_USER ||= 'local'
          process.env.DASHBOARD_AUTH_PASS ||= 'local'
          req.headers.authorization =
            'Basic ' + Buffer.from(`${process.env.DASHBOARD_AUTH_USER}:${process.env.DASHBOARD_AUTH_PASS}`).toString('base64')

          const { default: handler } = await server.ssrLoadModule('/api/leads.js')
          const out = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
          await handler(req, out)

          let body = out.body
          const snapshot = resolve('.local-audit.json')
          if (out.code === 200 && body && existsSync(snapshot)) {
            const snap = JSON.parse(readFileSync(snapshot, 'utf8'))
            // only fill what the real sheet does not have yet
            for (const [key, snapKey] of [['appointments', 'appointments'], ['flags', 'flags'], ['locks', 'locks'], ['callEvidence', 'call_evidence'], ['callActivity', 'call_activity']]) {
              if (!body[key] || body[key].length === 0) body = { ...body, [key]: snap[snapKey] || [] }
            }
          }
          send(out.code, body)
        } catch (err) {
          send(502, { error: 'local_api_failed', detail: String(err?.message || err) })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
})
