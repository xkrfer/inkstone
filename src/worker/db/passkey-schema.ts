export const PASSKEY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS passkey_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revision INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkey_credentials(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'login', 'delete')),
    user_id TEXT,
    session_id TEXT,
    browser_hash TEXT,
    password_hash TEXT,
    totp_generation TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    claimed_by TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webauthn_claimed ON webauthn_challenges(claimed_by) WHERE claimed_by IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_challenges(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webauthn_expires ON webauthn_challenges(expires_at)`,
] as const
