import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const ORIGIN = 'http://localhost:7712'
export async function createRuntime(storage = 'r2', { browser = false, sourceRoot = process.cwd() } = {}) {
  const built = await build({ entryPoints: [path.join(sourceRoot, 'scripts/testing/worker.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:*'], tsconfig: path.join(sourceRoot, 'tsconfig.worker.json') })
  const mf = new Miniflare({
    modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    ...(browser ? { port: 7712, host: '127.0.0.1' } : {}),
    bindings: { PUBLIC_URL: ORIGIN }, d1Databases: ['DB'], kvNamespaces: ['OAUTH_KV', ...(storage === 'kv' ? ['FILES_KV'] : [])],
    r2Buckets: storage === 'r2' ? ['FILES'] : [], durableObjects: { SYNC_HUB: { className: 'SyncHub', useSQLite: true }, CREDENTIAL_VAULT: { className: 'CredentialVault', useSQLite: true } },
    serviceBindings: { ASSETS: async (req) => {
      if (!browser) return new Response('Not found', { status: 404 })
      const root = path.resolve('dist/client')
      let name = path.resolve(root, '.' + new URL(req.url).pathname)
      if (!name.startsWith(root + path.sep)) name = path.join(root, 'index.html')
      let bytes
      try { bytes = await readFile(name) } catch { name = path.join(root, 'index.html'); bytes = await readFile(name) }
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }[path.extname(name)] ?? 'application/octet-stream'
      return new Response(bytes, { headers: { 'Content-Type': mime } })
    } },
  })
  await mf.ready
  return mf
}
export function client(mf) {
  const cookies = new Map()
  return {
    cookies,
    async request(method, route, body, overrides = {}) {
      const response = await mf.dispatchFetch(ORIGIN + route, { method,
        headers: { Origin: ORIGIN, 'X-Inkstone-Client': '1', 'Content-Type': 'application/json', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...overrides },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]; const i = pair.indexOf('='); const name = pair.slice(0, i); const value = pair.slice(i + 1)
        if (value) cookies.set(name, value); else cookies.delete(name)
      }
      return { status: response.status, body: await response.json(), headers: response.headers }
    },
  }
}
