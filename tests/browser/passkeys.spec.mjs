import { test, expect } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { createRuntime, ORIGIN } from '../../scripts/testing/passkey-runtime.mjs'

let runtime
let db
const password = 'browser-passkey-password-99'
const headers = { Origin: ORIGIN, 'X-Inkstone-Client': '1' }
test.beforeAll(async () => { runtime = await createRuntime('r2', { browser: true }); db = await runtime.getD1Database('DB') })
test.afterAll(async () => { await runtime?.dispose() })

async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  return { cdp, authenticatorId }
}
async function openAccount(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Account', exact: true }).click()
}
async function addPasskey(page, name) {
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click()
  await page.getByLabel('Passkey name', { exact: true }).fill(name)
  const form = page.locator('form').filter({ has: page.getByLabel('Passkey name', { exact: true }) })
  await form.getByLabel('Password', { exact: true }).fill(password)
  await form.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}
async function logout(page) {
  await page.request.post('/api/auth/logout', { headers })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible()
}
async function assertion(page, options) {
  return page.evaluate(async (options) => {
    const bytes = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: bytes(options.challenge), allowCredentials: [], timeout: 5000 } })
    return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: {
      clientDataJSON: encode(credential.response.clientDataJSON), authenticatorData: encode(credential.response.authenticatorData), signature: encode(credential.response.signature), userHandle: encode(credential.response.userHandle),
    } }
  }, options)
}

test('register, manage and sign in using real browser WebAuthn; enforce boundaries', async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem('inkstone-locale', 'en-US'))
  let { cdp, authenticatorId } = await virtualAuthenticator(page)
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('browser-owner')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create owner account', exact: true }).click()
  await openAccount(page)
  await addPasskey(page, 'Browser device')
  await page.screenshot({ path: 'test-results/passkey-settings.png', fullPage: true })
  const saved = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  ;({ cdp, authenticatorId } = await virtualAuthenticator(page))
  await addPasskey(page, 'Backup device')
  expect(saved.credentials).toHaveLength(1)
  const list = await (await page.request.get('/api/auth/passkeys')).json()
  expect(list).toHaveLength(2)
  const row = page.getByText('Browser device', { exact: true }).locator('../..')
  await row.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Passkey name', { exact: true }).fill('Renamed device')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('Renamed device', { exact: true })).toBeVisible()
  await logout(page)
  await page.screenshot({ path: 'test-results/passkey-login.png', fullPage: true })
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  const session = await (await page.request.get('/api/auth/session')).json()
  expect(session.user.username).toBe('browser-owner')
  await db.prepare('DELETE FROM login_attempts').run()
  const setup = await (await page.request.post('/api/auth/totp/setup', { headers, data: { currentPassword: password } })).json()
  let bits = ''; for (const char of setup.secret) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((v) => parseInt(v, 2)))
  const step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(step).digest()
  const code = ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0')
  const recovery = await (await page.request.post('/api/auth/totp/setup/confirm', { headers, data: { setupToken: setup.setupToken, code } })).json()
  await logout(page)
  const passwordResult = await (await page.request.post('/api/auth/login', { headers, data: { username: 'browser-owner', password } })).json()
  expect(passwordResult.twoFactorRequired).toBe(true)
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await db.prepare('DELETE FROM login_attempts').run()
  const opts = await (await page.request.post('/api/auth/passkeys/login/options', { headers })).json()
  const response = await assertion(page, opts.options)
  const foreign = await browser.newContext()
  expect((await foreign.request.post(ORIGIN + '/api/auth/passkeys/login/verify', { headers, data: { challengeId: opts.challengeId, response } })).status()).toBe(401)
  await foreign.close()
  await db.prepare('UPDATE webauthn_challenges SET expires_at = 0 WHERE id = ?1').bind(opts.challengeId).run()
  expect((await page.request.post('/api/auth/passkeys/login/verify', { headers, data: { challengeId: opts.challengeId, response } })).status()).toBe(409)
  const noUV = await (await page.request.post('/api/auth/passkeys/login/options', { headers })).json()
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false })
  const unverified = await assertion(page, { ...noUV.options, userVerification: 'discouraged' })
  expect((await page.request.post('/api/auth/passkeys/login/verify', { headers, data: { challengeId: noUV.challengeId, response: unverified } })).status()).toBe(401)
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true })
  const options2 = await (await page.request.post('/api/auth/passkeys/login/options', { headers })).json()
  const response2 = await assertion(page, options2.options)
  const deleted = await page.request.delete('/api/auth/passkeys/' + response2.id, { headers, data: { currentPassword: password, code: recovery.recoveryCodes[0] } })
  expect(deleted.status()).toBe(200)
  expect((await page.request.post('/api/auth/passkeys/login/verify', { headers, data: { challengeId: options2.challengeId, response: response2 } })).status()).toBe(401)
  const browserCredentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  expect(browserCredentials.credentials).toHaveLength(1)
  await db.prepare("INSERT INTO app_meta(key,value) VALUES ('setting:allow_registration','1') ON CONFLICT(key) DO UPDATE SET value='1'").run()
  expect((await page.request.post('/api/auth/register', { headers, data: { username: 'browser-member', password, locale: 'en-US' } })).status()).toBe(201)
  await page.reload()
  await openAccount(page)
  await addPasskey(page, 'Member device')
  const multipleAccounts = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  expect(multipleAccounts.credentials).toHaveLength(2)
  await cdp.send('WebAuthn.removeCredential', { authenticatorId, credentialId: browserCredentials.credentials[0].credentialId })
  await logout(page)
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  expect((await (await page.request.get('/api/auth/session')).json()).user.username).toBe('browser-member')
  await openAccount(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Member device', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/passkey-settings-mobile.png', fullPage: true })
  await page.getByText('Member device', { exact: true }).locator('../..').getByRole('button', { name: 'Delete', exact: true }).click()
  const deleteForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Confirm', exact: true }) })
  await deleteForm.getByLabel('Password', { exact: true }).fill(password)
  await deleteForm.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('Member device', { exact: true })).toHaveCount(0)
  await logout(page)
  await page.context().setOffline(true)
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled()
  await page.context().setOffline(false)
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled()
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false })
  let optionRequests = 0
  await page.route('**/api/auth/passkeys/login/options', async (route) => {
    optionRequests++
    const result = await route.fetch()
    const body = await result.json()
    body.options.timeout = 1000
    await route.fulfill({ response: result, json: body })
  })
  await page.getByRole('button', { name: 'Sign in with a passkey' }).evaluate((button) => { button.click(); button.click() })
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled({ timeout: 10000 })
  await expect(page.getByText(/Passkey operation was not completed/)).toBeVisible()
  expect(optionRequests).toBe(1)
  expect((await (await page.request.get('/api/auth/session')).json()).user).toBeNull()

})
