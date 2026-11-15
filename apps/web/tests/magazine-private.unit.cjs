// Offline tests of the actual proxy module with fake auth and Next responses.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-test-only'

class FakeResponse {
  constructor(body, { status = 200 } = {}) {
    this.status = status
    this.headers = new Headers()
    this.cookies = { set() {} }
  }
  static next() { return new FakeResponse(null) }
  static redirect(url) {
    const response = new FakeResponse(null, { status: 307 })
    response.headers.set('location', String(url))
    return response
  }
}

let auth = {}
const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: auth.user ?? null } }) },
  from: table => {
    assert.equal(table, 'user_roles')
    return {
      select: () => ({
        eq: (field, value) => {
          assert.equal(field, 'user_id')
          assert.equal(value, auth.user.id)
          return { maybeSingle: async () => ({ data: auth.role ? { role: auth.role } : null, error: auth.error ?? null }) }
        },
      }),
    }
  },
})

const filename = path.resolve(__dirname, '../src/proxy.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === '@supabase/ssr') return { createServerClient: fakeClient }
  if (request === 'next/server') return { NextResponse: FakeResponse }
  return originalLoad.call(this, request, parent, isMain)
}
const proxyModule = new Module(filename, module)
proxyModule.filename = filename
proxyModule.paths = module.paths
proxyModule._compile(compiled, filename)
Module._load = originalLoad
const { default: proxy, config } = proxyModule.exports

function request(url, cookie = false) {
  return {
    url,
    nextUrl: new URL(url),
    cookies: { getAll: () => cookie ? [{ name: 'sb-test-auth-token', value: 'stale' }] : [], set() {} },
  }
}

async function main() {
  assert(config.matcher.includes('/magazine/:path*'))
  assert(config.matcher.includes('/magazine-covers/:path*'))
  for (const item of [
    { who: {}, path: '/magazine', status: 307 },
    { who: {}, path: '/magazine/2026-W18', status: 307 },
    { who: {}, path: '/magazine-covers/2026-W18.png', status: 404 },
    { who: { user: { id: 'member' } }, path: '/magazine', status: 404 },
    { who: { user: { id: 'editor' }, role: 'editor' }, path: '/magazine/2026-W18', status: 404 },
    { who: { user: { id: 'admin' }, role: 'admin' }, path: '/magazine', status: 200 },
    { who: { user: { id: 'admin' }, role: 'admin' }, path: '/magazine/2026-W18', status: 200 },
    { who: { user: { id: 'admin' }, role: 'admin' }, path: '/magazine-covers/2026-W18.png', status: 200 },
    { who: { user: { id: 'admin' }, error: { message: 'unavailable' } }, path: '/magazine', status: 404 },
  ]) {
    auth = item.who
    const result = await proxy(request('https://example.invalid' + item.path))
    assert.equal(result.status, item.status, item.path)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
    assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow')
    if (item.status === 307) assert(result.headers.get('location').includes('/login?return='))
  }
  auth = {}
  const login = await proxy(request('https://example.invalid/login?return=%2Fmagazine', true))
  assert.equal(login.status, 200, 'stale cookie must not redirect back into a login loop')
  console.log('PASS: 10 offline proxy authorization, cache and stale-cookie checks')

  const coversFile = path.resolve(__dirname, '../src/lib/magazineCovers.ts')
  const coversCode = ts.transpileModule(fs.readFileSync(coversFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const coversModule = new Module(coversFile, module)
  coversModule.filename = coversFile
  coversModule.paths = module.paths
  coversModule._compile(coversCode, coversFile)
  for (const week of ['2026-W18', '2026-W19', '2026-W20', '2026-W21', 'new-week']) {
    assert.equal(coversModule.exports.getMagazineCoverUrl(week, 'https://example.invalid/old-cover.png'), null)
    assert.equal(coversModule.exports.hasLocalMagazineCover(week), false)
  }
  console.log('PASS: old local and Storage fallback covers suppressed')

  const originalTimer = global.setTimeout
  const originalClear = global.clearTimeout
  const originalWindow = global.window
  let nextTimer = 0
  const timers = new Map()
  const navigations = []
  global.setTimeout = fn => { const id = ++nextTimer; timers.set(id, fn); return id }
  global.clearTimeout = id => timers.delete(id)
  global.window = { location: { assign: url => navigations.push(url) } }
  const element = (type, props) => ({ type, props: props ?? {} })
  Module._load = function(request, parent, isMain) {
    if (request === 'react') return {
      useState: value => [value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }),
    }
    if (request === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'fragment' }
    if (request === 'next/link') return { __esModule: true, default: 'link' }
    if (request === 'next/navigation') return { usePathname: () => '/' }
    if (request === '@/lib/supabase') return { supabase: {} }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const headerFile = path.resolve(__dirname, '../src/components/PublicSiteHeader.tsx')
    const headerCode = ts.transpileModule(fs.readFileSync(headerFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const headerModule = new Module(headerFile, module)
    headerModule.filename = headerFile
    headerModule.paths = module.paths
    headerModule._compile(headerCode, headerFile)
    const tree = headerModule.exports.default()
    function findLogo(node) {
      if (!node || typeof node !== 'object') return null
      if (node.type === 'link' && node.props.href === '/' && node.props.onClick) return node
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = findLogo(child)
        if (found) return found
      }
      return null
    }
    const logo = findLogo(tree)
    assert(logo, 'logo control exists')
    const click = () => logo.props.onClick({ detail: 1, preventDefault() {} })
    for (let n = 0; n < 4; n += 1) click()
    assert.deepEqual(navigations, [])
    click()
    assert.deepEqual(navigations, ['/magazine'], 'five taps open the magazine')
    assert.equal(timers.size, 0, 'five taps cancel the ordinary navigation')
    click()
    assert.equal(timers.size, 1)
    for (const fn of timers.values()) fn()
    assert.deepEqual(navigations, ['/magazine', '/'], 'one tap still opens home after timeout')
    let prevented = false
    logo.props.onClick({ detail: 0, preventDefault() { prevented = true } })
    assert.equal(prevented, false, 'keyboard activation retains the normal link')
    console.log('PASS: offline five-tap, single-tap and keyboard checks')
  } finally {
    Module._load = originalLoad
    global.setTimeout = originalTimer
    global.clearTimeout = originalClear
    global.window = originalWindow
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
