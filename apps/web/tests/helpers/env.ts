import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env.test')

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'TEST_EDITOR_EMAIL',
  'TEST_EDITOR_PASSWORD',
  'TEST_ADMIN_EMAIL',
  'TEST_ADMIN_PASSWORD',
] as const

export type TestEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
  serviceRoleKey?: string
  editorEmail: string
  editorPassword: string
  adminEmail: string
  adminPassword: string
  revokedEmail: string
  revokedPassword: string
}

let envLoaded = false

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function loadEnvFile() {
  if (envLoaded || !existsSync(ENV_FILE_PATH)) {
    return
  }

  const content = readFileSync(ENV_FILE_PATH, 'utf8')

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    process.env[key] = stripWrappingQuotes(rawValue)
  }

  envLoaded = true
}

function missingRequiredKeys() {
  loadEnvFile()

  return REQUIRED_KEYS.filter((key) => !process.env[key])
}

export function hasTestEnvFile() {
  return existsSync(ENV_FILE_PATH)
}

export function getTestEnvSkipReason() {
  if (!hasTestEnvFile()) {
    return '.env.test が存在しないため、この E2E テストはスキップされます。'
  }

  const missingKeys = missingRequiredKeys()
  if (missingKeys.length > 0) {
    return `.env.test の必須項目が不足しているため、この E2E テストはスキップされます: ${missingKeys.join(', ')}`
  }

  return ''
}

export function getTestEnv(): TestEnv | null {
  if (!hasTestEnvFile()) {
    return null
  }

  const missingKeys = missingRequiredKeys()
  if (missingKeys.length > 0) {
    return null
  }

  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    editorEmail: process.env.TEST_EDITOR_EMAIL!,
    editorPassword: process.env.TEST_EDITOR_PASSWORD!,
    adminEmail: process.env.TEST_ADMIN_EMAIL!,
    adminPassword: process.env.TEST_ADMIN_PASSWORD!,
    revokedEmail: process.env.TEST_REVOKED_EMAIL ?? 'revoked-e2e@example.com',
    revokedPassword: process.env.TEST_REVOKED_PASSWORD ?? 'RevokedUser123!',
  }
}
