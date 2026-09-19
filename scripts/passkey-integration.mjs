import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { build } from 'esbuild'
import { createRuntime, client, ORIGIN } from './testing/passkey-runtime.mjs'
import { authenticator } from './testing/webauthn-fixture.mjs'

const password = 'passkey-test-password-99'
const path = '/api/auth/passkeys'
function totp(secret) {
  let bits = ''
  for (const char of secret) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((v) => parseInt(v, 2)))
  const step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(step).digest(); const offset = digest.at(-1) & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0')
}
async function expected(client, method, route, body, status = 200) {
  const result = await client.request(method, route, body)
  assert.equal(result.status, status, JSON.stringify(result.body))
  return result.body
}

for (const lineage of ['fork', 'upstream']) {
  test(`schema migration 12 from ${lineage} upgrades without losing data`, async (t) => {
    const mf = await createRuntime()
    t.after(() => mf.dispose())
    const db = await mf.getD1Database('DB')
    const built = await build({ stdin: { contents: "export {SCHEMA_STATEMENTS} from './src/worker/db/schema.ts'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' })
    const { SCHEMA_STATEMENTS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
    const statements = lineage === 'fork'
      ? SCHEMA_STATEMENTS.filter((s) => !/idx_notes_user_id|idx_tags_name_nocase|idx_versions_user/.test(s))
        .map((s) => s.replace('created_at DESC, id DESC', 'created_at DESC').replace('started_at DESC, id DESC', 'started_at DESC'))
      : SCHEMA_STATEMENTS.filter((s) => !/passkey|webauthn/.test(s))
    await db.batch(statements.map((s) => db.prepare(s)))
    await db.batch(Array.from({ length: 12 }, (_, i) => db.prepare('INSERT INTO schema_migrations VALUES (?1, 1)').bind(i + 1)))
    await db.prepare("INSERT INTO users (id, username, password_hash, login, created_at, last_seen_at) VALUES ('legacy', 'legacy', 'preserved-hash', 'legacy', 1, 1)").run()
    await db.prepare("INSERT INTO notes (id, user_id, content, created_at, updated_at) VALUES ('legacy-note', 'legacy', 'Preserved content', 1, 1)").run()
    await db.prepare('CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED, user_id UNINDEXED, title, body)').run()
    await db.prepare("INSERT INTO notes_fts(rowid, note_id, user_id, title, body) VALUES (42, 'legacy-note', 'legacy', 'Legacy', 'Preserved content')").run()
    if (lineage === 'fork') {
      await db.prepare("INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES ('credential', 'legacy', 'preserved-key', 7, '[]', 'singleDevice', 0, 'Existing key', 1)").run()
    }
    const before = lineage === 'fork' ? (await db.prepare('SELECT * FROM passkey_credentials').all()).results : []
    const who = client(mf)
    await expected(who, 'GET', '/api/auth/session')
    assert.ok(await db.prepare('SELECT 1 FROM schema_migrations WHERE version = 13').first())
    assert.equal((await db.prepare("SELECT content FROM notes WHERE id = 'legacy-note'").first()).content, 'Preserved content')
    assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id = 'legacy'").first()).password_hash, 'preserved-hash')
    assert.deepEqual((await db.prepare('SELECT * FROM passkey_credentials').all()).results, before)
    for (const name of ['idx_versions_note', 'idx_runs_user']) {
      assert.match((await db.prepare('SELECT sql FROM sqlite_master WHERE name = ?1').bind(name).first()).sql, /id DESC/)
    }
    for (const name of ['idx_notes_user_id', 'idx_tags_name_nocase', 'idx_versions_user']) {
      assert.ok(await db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?1').bind(name).first())
    }
    assert.deepEqual((await db.prepare("SELECT rowid, body FROM notes_fts WHERE notes_fts MATCH 'note_id : \"legacy-note\"'").all()).results, [{ rowid: 42, body: 'Preserved content' }])
    await expected(who, 'GET', '/api/auth/session')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 13').first()).n, 1)
  })
}

for (const storage of ['r2', 'kv']) {
  test(`Passkeys in workerd with real D1 (${storage})`, async (t) => {
    const mf = await createRuntime(storage)
    t.after(() => mf.dispose())
    const db = await mf.getD1Database('DB')
    const owner = client(mf)
    let userId
    const key = authenticator()
    async function clear() { await db.prepare('DELETE FROM login_attempts').run() }
    async function options(who = owner, extra = {}) { return expected(who, 'POST', path + '/registration/options', { currentPassword: password, ...extra }) }
    async function register(auth, who = owner, extra = {}) {
      const opts = await options(who, extra)
      return expected(who, 'POST', path + '/registration/verify', { challengeId: opts.challengeId, response: auth.register(opts.options), name: 'Test device' }, 201)
    }
    async function login(auth, who = client(mf), overrides = {}) {
      const opts = await expected(who, 'POST', path + '/login/options')
      return who.request('POST', path + '/login/verify', { challengeId: opts.challengeId, response: auth.authenticate(opts.options, overrides) })
    }
    await t.test('upgrade from the previous schema preserves users and notes; initialization is repeatable', async () => {
      const built = await build({ stdin: { contents: "export {SCHEMA_STATEMENTS} from './src/worker/db/schema.ts'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' })
      const { SCHEMA_STATEMENTS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
      const old = SCHEMA_STATEMENTS.filter((s) => !/passkey|webauthn/.test(s))
      await db.batch(old.map((s) => db.prepare(s)))
      await db.prepare("INSERT INTO users (id, username, password_hash, login, created_at, last_seen_at) VALUES ('legacy-user', 'legacy-user', 'preserved-hash', 'legacy-user', 1, 1)").run()
      await db.prepare("INSERT INTO notes (id, user_id, content, created_at, updated_at) VALUES ('legacy-note', 'legacy-user', 'Preserve this note', 1, 1)").run()
      await db.prepare("INSERT INTO app_meta(key, value) VALUES ('setting:allow_registration', '1')").run()
      const info = await expected(owner, 'POST', '/api/auth/register', { username: 'owner', password }, 201)
      userId = info.user.id
      assert.equal(info.site.passkeyEnabled, true)
      const before = await db.prepare('SELECT id, content FROM notes').all()
      await expected(owner, 'GET', '/api/auth/session')
      assert.deepEqual((await db.prepare('SELECT id, content FROM notes').all()).results, before.results)
      assert.ok(await db.prepare('SELECT 1 FROM schema_migrations WHERE version = 12').first())
      assert.equal((await db.prepare("SELECT content FROM notes WHERE id = 'legacy-note'").first()).content, 'Preserve this note')
      assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id = 'legacy-user'").first()).password_hash, 'preserved-hash')
      await db.batch(old.map((s) => db.prepare(s)))
    })
    await t.test('registration and username-less login verify real ES256 signatures', async () => {
      await clear()
      const result = await register(key)
      assert.equal(result.id, key.id)
      const resultLogin = await login(key)
      assert.equal(resultLogin.status, 200, JSON.stringify(resultLogin.body))
      assert.equal(resultLogin.body.user.id, userId)
      assert.equal('twoFactorRequired' in resultLogin.body, false)
      assert.equal(resultLogin.headers.get('Cache-Control'), 'no-store')
    })
    await t.test('registration rejects RP ID, origin, challenge and UV failures', async () => {
      for (const invalid of [{ rpId: 'evil.example' }, { client: { origin: 'https://evil.example' } }, { client: { challenge: 'wrong' } }, { flags: 0x41 }]) {
        await clear()
        const opts = await options()
        const result = await owner.request('POST', path + '/registration/verify', { challengeId: opts.challengeId, response: authenticator().register(opts.options, invalid), name: 'bad' })
        assert.equal(result.status, 401)
      }
    })
    await t.test('login rejects invalid signed fields, UV, signature and identity without sessions', async () => {
      for (const invalid of [{ rpId: 'evil.example' }, { client: { origin: 'https://evil.example' } }, { client: { challenge: 'wrong' } }, { flags: 1 }, { userHandle: 'wrong' }, { signature: true }]) {
        await clear()
        const who = client(mf)
        const opts = await expected(who, 'POST', path + '/login/options')
        const response = key.authenticate(opts.options, invalid)
        if (invalid.signature) response.response.signature = 'invalid'
        const before = await db.prepare('SELECT COUNT(*) AS n FROM sessions').first()
        const result = await who.request('POST', path + '/login/verify', { challengeId: opts.challengeId, response })
        assert.equal(result.status, 401)
        assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first(), before)
      }
    })
    await t.test('browser binding, HTTP Origin and expiry are enforced', async () => {
      await clear()
      const who = client(mf)
      const opts = await expected(who, 'POST', path + '/login/options')
      const body = { challengeId: opts.challengeId, response: key.authenticate(opts.options) }
      assert.equal((await client(mf).request('POST', path + '/login/verify', body)).status, 401)
      assert.equal((await who.request('POST', path + '/login/verify', body, { Origin: 'https://evil.example' })).status, 403)
      assert.equal((await who.request('POST', path + '/login/verify', body, { Origin: '' })).status, 403)
      await db.prepare('UPDATE webauthn_challenges SET expires_at = 0 WHERE id = ?1').bind(opts.challengeId).run()
      assert.equal((await who.request('POST', path + '/login/verify', body)).status, 409)
    })
    await t.test('parallel tabs retain separate cookies; concurrent replay creates exactly one session', async () => {
      await clear()
      const who = client(mf)
      const opts = await expected(who, 'POST', path + '/login/options')
      const other = await expected(who, 'POST', path + '/login/options')
      assert.notEqual(opts.challengeId, other.challengeId)
      const body = { challengeId: opts.challengeId, response: key.authenticate(opts.options) }
      const before = (await db.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n
      const results = await Promise.all([who.request('POST', path + '/login/verify', body), who.request('POST', path + '/login/verify', body)])
      assert.equal(results.filter((r) => r.status === 200).length, 1)
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n, before + 1)
      assert.notEqual((await who.request('POST', path + '/login/verify', body)).status, 200)
      assert.equal((await who.request('POST', path + '/login/verify', { challengeId: other.challengeId, response: key.authenticate(other.options) })).status, 200)
    })
    await t.test('duplicate credentials, name bounds and ownership are enforced', async () => {
      await clear()
      const opts = await options()
      assert.equal((await owner.request('POST', path + '/registration/verify', { challengeId: opts.challengeId, response: key.register(opts.options), name: 'again' })).body.error.code, 'passkey_duplicate')
      assert.equal((await owner.request('PATCH', path + '/' + key.id, { name: ' ' })).status, 400)
      assert.equal((await owner.request('PATCH', path + '/' + key.id, { name: 'x'.repeat(65) })).status, 400)
      await expected(owner, 'PATCH', path + '/' + key.id, { name: 'Renamed' })
      assert.equal((await expected(owner, 'GET', path))[0].name, 'Renamed')
      await db.prepare("INSERT INTO app_meta(key,value) VALUES ('setting:allow_registration','1') ON CONFLICT(key) DO UPDATE SET value='1'").run()
      const other = client(mf)
      await expected(other, 'POST', '/api/auth/register', { username: 'member', password }, 201)
      assert.equal((await other.request('PATCH', path + '/' + key.id, { name: 'stolen' })).status, 404)
      assert.equal((await other.request('DELETE', path + '/' + key.id, { currentPassword: password })).status, 404)
      const foreign = await options()
      assert.equal((await other.request('POST', path + '/registration/verify', { challengeId: foreign.challengeId, response: authenticator().register(foreign.options), name: 'bad' })).status, 401)
    })
    await t.test('registration authorization expires on logout or password state change', async () => {
      for (const action of ['logout', 'password']) {
        await clear()
        const device = client(mf)
        await expected(device, 'POST', '/api/auth/login', { username: 'owner', password })
        const opts = await options(device)
        const body = { challengeId: opts.challengeId, response: authenticator().register(opts.options), name: 'late' }
        if (action === 'logout') await expected(device, 'POST', '/api/auth/logout')
        else await db.prepare("UPDATE users SET password_hash = password_hash || 'changed' WHERE id = ?1").bind(userId).run()
        assert.notEqual((await device.request('POST', path + '/registration/verify', body)).status, 201)
        if (action === 'password') await db.prepare("UPDATE users SET password_hash = substr(password_hash,1,length(password_hash)-7) WHERE id = ?1").bind(userId).run()
      }
    })
    await t.test('TOTP binding proof, dynamic-code replay and one-use recovery codes', async () => {
      await clear()
      const pending = await options()
      const setup = await expected(owner, 'POST', '/api/auth/totp/setup', { currentPassword: password })
      const confirmation = await expected(owner, 'POST', '/api/auth/totp/setup/confirm', { setupToken: setup.setupToken, code: totp(setup.secret) })
      assert.equal((await owner.request('POST', path + '/registration/verify', { challengeId: pending.challengeId, response: authenticator().register(pending.options), name: 'stale' })).status, 409)
      assert.equal((await owner.request('POST', path + '/registration/options', { currentPassword: password, code: 'wrong' })).status, 401)
      await options(owner, { code: totp(setup.secret) })
      assert.equal((await owner.request('POST', path + '/registration/options', { currentPassword: password, code: totp(setup.secret) })).status, 401)
      await clear()
      const recovery = confirmation.recoveryCodes[0]
      const second = authenticator()
      await register(second, owner, { code: recovery })
      assert.equal((await owner.request('POST', path + '/registration/options', { currentPassword: password, code: recovery })).status, 401)
      assert.equal((await login(key)).status, 200)
      assert.equal((await expected(client(mf), 'POST', '/api/auth/login', { username: 'owner', password })).twoFactorRequired, true)
      await expected(owner, 'DELETE', path + '/' + second.id, { currentPassword: password, code: confirmation.recoveryCodes[1] })
      assert.equal((await login(second)).status, 401)
      await expected(owner, 'DELETE', '/api/auth/totp', { currentPassword: password, code: confirmation.recoveryCodes[2] })
    })
    await t.test('concurrent registration consumes one grant; deletion wins over pending assertions', async () => {
      await clear()
      const opts = await options()
      const temp = authenticator()
      const body = { challengeId: opts.challengeId, response: temp.register(opts.options), name: 'Concurrent' }
      const results = await Promise.all([owner.request('POST', path + '/registration/verify', body), owner.request('POST', path + '/registration/verify', body)])
      assert.equal(results.filter((r) => r.status === 201).length, 1)
      const device = client(mf)
      const loginOpts = await expected(device, 'POST', path + '/login/options')
      const loginBody = { challengeId: loginOpts.challengeId, response: temp.authenticate(loginOpts.options) }
      const [deletion, signedIn] = await Promise.all([
        owner.request('DELETE', path + '/' + temp.id, { currentPassword: password }),
        device.request('POST', path + '/login/verify', loginBody),
      ])
      assert.equal(deletion.status, 200)
      assert.ok([200, 401, 409].includes(signedIn.status))
      assert.equal((await expected(device, 'GET', '/api/auth/session')).user, null)
      assert.equal((await login(temp)).status, 401)
    })
    await t.test('database cap, revoked sessions, zero counters and deleting the last passkey', async () => {
      await clear()
      const zero = authenticator()
      await register(zero)
      assert.equal((await login(zero, client(mf), { counter: 0 })).status, 200)
      assert.equal((await login(zero, client(mf), { counter: 0 })).status, 200)
      const opts = await options()
      await db.prepare(`INSERT INTO passkey_credentials SELECT id || '-copy', user_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at, revision FROM passkey_credentials`).run()
      await db.prepare(`INSERT INTO passkey_credentials SELECT id || '-copy2', user_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at, revision FROM passkey_credentials`).run()
      await db.prepare(`INSERT INTO passkey_credentials SELECT id || '-copy3', user_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at, revision FROM passkey_credentials LIMIT 2`).run()
      assert.equal((await owner.request('POST', path + '/registration/options', { currentPassword: password })).body.error.code, 'passkey_limit')
      assert.equal((await owner.request('POST', path + '/registration/verify', { challengeId: opts.challengeId, response: authenticator().register(opts.options), name: 'overflow' })).status, 409)
      await db.prepare('DELETE FROM passkey_credentials WHERE id != ?1').bind(key.id).run()
      const device = client(mf)
      await expected(device, 'POST', '/api/auth/login', { username: 'owner', password })
      await expected(owner, 'DELETE', path + '/' + key.id, { currentPassword: password })
      assert.equal((await expected(device, 'GET', '/api/auth/session')).user, null)
      assert.equal((await login(key)).status, 401)
      assert.equal((await expected(owner, 'GET', path)).length, 0)
    })
    await t.test('maintenance removes expired challenges without removing live credentials or challenges', async () => {
      await clear()
      const who = client(mf)
      const expired = await expected(who, 'POST', path + '/login/options')
      const live = await expected(who, 'POST', path + '/login/options')
      await db.prepare('UPDATE webauthn_challenges SET expires_at = 0 WHERE id = ?1').bind(expired.challengeId).run()
      const built = await build({ entryPoints: ['src/worker/lib/maintenance.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
      const { purgeExpiredOperationalData } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
      await purgeExpiredOperationalData(db)
      assert.equal(await db.prepare('SELECT 1 FROM webauthn_challenges WHERE id = ?1').bind(expired.challengeId).first(), null)
      assert.ok(await db.prepare('SELECT 1 FROM webauthn_challenges WHERE id = ?1').bind(live.challengeId).first())
    })
    await t.test('IP budgets and payload limits', async () => {
      await clear()
      const who = client(mf)
      assert.equal((await who.request('POST', path + '/login/verify', { padding: 'x'.repeat(65536) })).status, 413)
      let status
      for (let i = 0; i < 61; i++) status = (await who.request('POST', path + '/login/options')).status
      assert.equal(status, 429)
    })
  })
}
