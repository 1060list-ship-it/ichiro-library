import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test as base, type Page } from '@playwright/test'

type RoleName = 'editor' | 'admin'

type RoleCredentials = {
  email: string
  password: string
}

type SupabaseAnonConfig = {
  url: string
  anonKey: string
}

type TestConfig = {
  editorUser: RoleCredentials | null
  adminUser: RoleCredentials | null
  supabaseAnon: SupabaseAnonConfig | null
}

type BrowserFetchResult = {
  ok: boolean
  status: number
  json: unknown
  text: string
}

type SubmitLoginOptions = {
  email: string
  password: string
  returnTo?: string
  returnQueryValue?: string
}

type E2EFixtures = {
  editorUser: RoleCredentials | null
  adminUser: RoleCredentials | null
  supabaseAnon: SupabaseAnonConfig | null
  loginAs: (role: RoleName, returnTo?: string) => Promise<void>
}

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env.test')

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

function readEnv(key: string) {
  loadEnvFile()

  const value = process.env[key]?.trim()
  return value ? value : null
}

function readRoleCredentials(prefix: 'EDITOR' | 'ADMIN') {
  const email = readEnv(`TEST_${prefix}_EMAIL`)
  const password = readEnv(`TEST_${prefix}_PASSWORD`)

  if (!email || !password) {
    return null
  }

  return {
    email,
    password,
  }
}

function readSupabaseAnonConfig() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (!url || !anonKey) {
    return null
  }

  return {
    url,
    anonKey,
  }
}

function loadTestConfig(): TestConfig {
  return {
    editorUser: readRoleCredentials('EDITOR'),
    adminUser: readRoleCredentials('ADMIN'),
    supabaseAnon: readSupabaseAnonConfig(),
  }
}

export function getRoleSkipReason(role: RoleName) {
  return role === 'admin'
    ? 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD が未設定のためスキップします。'
    : 'TEST_EDITOR_EMAIL / TEST_EDITOR_PASSWORD が未設定のためスキップします。'
}

export function getSupabaseSkipReason() {
  return 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定のためスキップします。'
}

export async function submitLoginForm(page: Page, options: SubmitLoginOptions) {
  const returnTo = options.returnTo ?? '/member'
  const returnQueryValue = options.returnQueryValue ?? encodeURIComponent(returnTo)

  await page.context().clearCookies()
  await page.goto(`/login?return=${returnQueryValue}`)
  await page.getByLabel('Email').fill(options.email)
  await page.getByLabel('Password').fill(options.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

export async function logout(page: Page) {
  await Promise.all([
    page.waitForURL('**/'),
    page.getByRole('button', { name: 'ログアウト' }).click(),
  ])
}

export async function browserFetchJson(
  page: Page,
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  },
) {
  return page.evaluate<
    BrowserFetchResult,
    {
      url: string
      init?: {
        method?: string
        headers?: Record<string, string>
        body?: string
      }
    }
  >(async ({ url: targetUrl, init: requestInit }) => {
    const response = await fetch(targetUrl, requestInit)
    const text = await response.text()
    let json: unknown = null

    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    }
  }, { url, init })
}

export const test = base.extend<E2EFixtures>({
  editorUser: async ({}, use) => {
    await use(loadTestConfig().editorUser)
  },
  adminUser: async ({}, use) => {
    await use(loadTestConfig().adminUser)
  },
  supabaseAnon: async ({}, use) => {
    await use(loadTestConfig().supabaseAnon)
  },
  loginAs: async ({ page, editorUser, adminUser }, use) => {
    await use(async (role, returnTo = '/member') => {
      const credentials = role === 'admin' ? adminUser : editorUser

      if (!credentials) {
        throw new Error(getRoleSkipReason(role))
      }

      await submitLoginForm(page, {
        email: credentials.email,
        password: credentials.password,
        returnTo,
      })
    })
  },
})

export { expect }
