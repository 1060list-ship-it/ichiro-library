import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(scriptDir, '..')

function loadEnvFile(filePath, overwrite) {
  if (!existsSync(filePath)) {
    return
  }

  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (overwrite || !process.env[key]) {
      process.env[key] = value
    }
  }
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function assertLocalSupabaseUrl(url) {
  const hostname = new URL(url).hostname
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('Refusing to seed test users into a non-local Supabase project.')
  }
}

async function findUserByEmail(supabase, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      throw new Error(`Unable to list Auth users: ${error.message}`)
    }

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase())
    if (user) {
      return user
    }

    if (data.users.length < 1000) {
      return null
    }
  }
}

async function upsertTestUser(supabase, { role, email, password }) {
  const existing = await findUserByEmail(supabase, email)
  let userId

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`Unable to update ${role} test user: ${error?.message ?? 'unknown error'}`)
    }
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`Unable to create ${role} test user: ${error?.message ?? 'unknown error'}`)
    }
    userId = data.user.id
  }

  const { error: roleError } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id' })

  if (roleError) {
    throw new Error(`Unable to assign ${role} role: ${roleError.message}`)
  }

  return existing ? 'updated' : 'created'
}

async function main() {
  loadEnvFile(path.join(appDir, '.env.local'), false)
  loadEnvFile(path.join(appDir, '.env.test'), true)

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  assertLocalSupabaseUrl(supabaseUrl)

  const supabase = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const results = await Promise.all([
    upsertTestUser(supabase, {
      role: 'editor',
      email: requireEnv('TEST_EDITOR_EMAIL'),
      password: requireEnv('TEST_EDITOR_PASSWORD'),
    }),
    upsertTestUser(supabase, {
      role: 'admin',
      email: requireEnv('TEST_ADMIN_EMAIL'),
      password: requireEnv('TEST_ADMIN_PASSWORD'),
    }),
  ])

  console.log(`Test users ready: editor ${results[0]}, admin ${results[1]}.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to seed test users.')
  process.exitCode = 1
})
