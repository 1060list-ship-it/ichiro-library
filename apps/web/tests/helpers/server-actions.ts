import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { encodeReply } from 'next/dist/compiled/react-server-dom-turbopack/client.edge'
import { createAuthCookieHeader, createStaleAuthCookieHeader, getAppBaseUrl, type TestRole } from './auth'

type ServerActionOptions = {
  actionName: string
  actionArgs: unknown[]
  manifestRoute: string
  pagePath: string
  role?: TestRole
  actionCookieHeader?: string
  treeRole?: TestRole
}

export type ServerActionResponse = {
  status: number
  location: string | null
  text: string
  errorMessage: string | null
}

function getManifestPath(manifestRoute: string) {
  return path.resolve(process.cwd(), '.next/dev/server/app', manifestRoute, 'page/server-reference-manifest.json')
}

function extractFlightPayload(html: string) {
  const scripts = [...html.matchAll(/<script>self\.__next_f\.push\((.*?)\)<\/script>/gs)]

  for (const [, scriptBody] of scripts) {
    const pushPayload = vm.runInNewContext(scriptBody)

    if (
      Array.isArray(pushPayload)
      && pushPayload[0] === 1
      && typeof pushPayload[1] === 'string'
      && pushPayload[1].startsWith('0:{')
    ) {
      const firstLine = pushPayload[1].split('\n', 1)[0]
      return JSON.parse(firstLine.slice(2)) as {
        f?: unknown[]
      }
    }
  }

  throw new Error('Failed to locate the initial Flight payload.')
}

function toMinimalRouterTree(payload: { f?: unknown[] }) {
  const tree = payload.f?.[0]

  if (!Array.isArray(tree) || !Array.isArray(tree[0]) || tree[0].length < 2) {
    throw new Error('Failed to extract the router tree for the Server Action request.')
  }

  return [tree[0][0], tree[0][1]]
}

function extractErrorMessage(text: string) {
  const match = text.match(/"message":"((?:[^"\\]|\\.)*)"/)

  if (!match) {
    return null
  }

  return JSON.parse(`"${match[1]}"`) as string
}

async function getCookieHeaderForRole(role?: TestRole) {
  if (!role) {
    return ''
  }

  return createAuthCookieHeader(role)
}

async function resolveActionId(manifestRoute: string, pagePath: string, treeCookieHeader: string) {
  const manifestPath = getManifestPath(manifestRoute)

  if (!existsSync(manifestPath)) {
    await fetch(new URL(pagePath, getAppBaseUrl()), {
      headers: treeCookieHeader ? { cookie: treeCookieHeader } : undefined,
      redirect: 'manual',
    })
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    node?: Record<string, { exportedName?: string }>
  }

  return manifest
}

export async function invokeServerAction(options: ServerActionOptions): Promise<ServerActionResponse> {
  const actionCookieHeader = options.actionCookieHeader
    ?? await getCookieHeaderForRole(options.role)
  const treeCookieHeader = options.treeRole
    ? await createAuthCookieHeader(options.treeRole)
    : actionCookieHeader

  const pageResponse = await fetch(new URL(options.pagePath, getAppBaseUrl()), {
    headers: treeCookieHeader ? { cookie: treeCookieHeader } : undefined,
    redirect: 'manual',
  })
  const pageHtml = await pageResponse.text()
  const flightPayload = extractFlightPayload(pageHtml)
  const routerTree = toMinimalRouterTree(flightPayload)
  const manifest = await resolveActionId(options.manifestRoute, options.pagePath, treeCookieHeader)

  const actionEntry = Object.entries(manifest.node ?? {}).find(([, value]) => value.exportedName === options.actionName)

  if (!actionEntry) {
    throw new Error(`Failed to resolve Server Action id for ${options.actionName}.`)
  }

  const body = await encodeReply(options.actionArgs, {
    temporaryReferences: undefined,
  })

  const response = await fetch(new URL(options.pagePath, getAppBaseUrl()), {
    method: 'POST',
    headers: {
      accept: 'text/x-component',
      'content-type': body.type || 'text/plain;charset=UTF-8',
      'next-action': actionEntry[0],
      'next-router-state-tree': encodeURIComponent(JSON.stringify(routerTree)),
      ...(actionCookieHeader ? { cookie: actionCookieHeader } : {}),
    },
    body,
    redirect: 'manual',
  })

  const text = await response.text()

  return {
    status: response.status,
    location: response.headers.get('location'),
    text,
    errorMessage: extractErrorMessage(text),
  }
}

export async function invokeMemberServerActionAsUnauthorized(actionName: string, actionArgs: unknown[]) {
  return invokeServerAction({
    actionName,
    actionArgs,
    manifestRoute: 'member',
    pagePath: '/member',
    actionCookieHeader: await createStaleAuthCookieHeader('editor'),
    treeRole: 'editor',
  })
}
