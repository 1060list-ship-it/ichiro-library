import { test, expect } from '@playwright/test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type * as BadgeModule from '../src/components/SummaryReviewBadge'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { fetchHomePageStreams } from '../src/lib/home-page'

const source = readFileSync(join(process.cwd(), 'src/components/SummaryReviewBadge.tsx'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const componentExports: Record<string, unknown> = {}
vm.runInNewContext(js, { exports: componentExports, require: (name: string) => {
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
  throw new Error(`unexpected component import: ${name}`)
} })
const { default: SummaryReviewBadge, SummaryReviewDetail } = componentExports as unknown as typeof BadgeModule

test('seven review states have the intended public labels', () => {
  for (const status of ['pending', 'reviewed_no_change', 'auto_fixed', 'needs_review', 'review_failed'] as const) {
    const html = renderToStaticMarkup(React.createElement(SummaryReviewBadge, { status }))
    expect(html).toContain('要約確認前')
    if (status === 'needs_review') expect(html).toContain('要確認箇所')
    if (status === 'review_failed') expect(html).toContain('校閲要再実行')
  }
  for (const status of ['confirmed', 'legacy_unreviewed'] as const) {
    expect(renderToStaticMarkup(React.createElement(SummaryReviewBadge, { status }))).toBe('')
  }
})

test('fuzzy results fetch public review status separately', async () => {
  const selects: string[] = []
  const client = {
    rpc: async () => ({ data: [{ id: 'one', title: 'test', summary: 'text', stream_date: '2026-01-01', tags: [], corner_names: [] }] }),
    from: (table: string) => ({ select: (columns: string) => ({ in: async () => {
      selects.push(`${table}:${columns}`)
      return { data: table === 'streams' ? [{ id: 'one', summary_review_status: 'needs_review' }] : [] }
    } }) }),
  }
  const result = await fetchHomePageStreams(client, { view: 'top', query: 'test', fuzzy: true, year: null, activeFilter: null })
  expect(result.streams[0].summary_review_status).toBe('needs_review')
  expect(selects).toContain('streams:id,summary_review_status')
})

test('detail renders evidence as escaped text and distinguishes states', () => {
  const attack = '<img src=x onerror=alert(1)>'
  const finding = { finding_no: 1, before_text: attack, after_text: attack, evidence: attack, confidence: 'low' }
  const render = (review: React.ComponentProps<typeof SummaryReviewDetail>['review'], error = '', loading = false) => renderToStaticMarkup(React.createElement(SummaryReviewDetail, { review, error, loading }))
  const html = render({ state: 'succeeded', current: true, findings: [finding] })
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(render({ state: 'succeeded', current: true, findings: [] })).toContain('指摘はありません')
  expect(render({ state: 'failed', current: true, findings: [] })).toContain('校閲に失敗')
  expect(render({ state: 'stale', current: false, findings: [finding] })).not.toContain('onerror')
  expect(render(null)).toContain('校閲結果はありません')
  expect(render(null, '取得失敗')).toContain('取得失敗')
  expect(render(null, '', true)).toContain('取得中')
})
