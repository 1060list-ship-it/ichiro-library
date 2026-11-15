import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import vm from 'node:vm'

type Row = Record<string, any>
const baseStream = { id: 'stream-1', summary: 'before', transcript: 'transcript', is_reviewed: false, summary_review_status: 'reviewed_no_change', summary_review_version: 1 }
const baseRun = { review_run_id: 'run-1', stream_id: 'stream-1', state: 'succeeded', input_version: 1, input_summary: 'before', input_transcript: 'transcript', result_payload: { summary: 'before', status: 'reviewed_no_change' } }
function loadAction(role: 'admin' | 'editor' | 'anonymous', stream: Row = baseStream, run: Row | null = baseRun, logs: Row[] = []) {
  const queries: { table: string; filters: [string, unknown][] }[] = []
  const db = { from(table: string) {
    const record: { table: string; filters: [string, unknown][] } = { table, filters: [] }; queries.push(record)
    const rows = table === 'streams' ? [{ video_id: 'video', ...stream }] : table === 'summary_review_runs' ? (run ? [run] : []) : table === 'summary_review_log' ? logs : (() => { throw Error(`unexpected table ${table}`) })()
    const filtered = () => rows.filter((row: Row) => record.filters.every(([key, value]) => row[key] === value))
    const query = { select: () => query, eq: (key: string, value: unknown) => { record.filters.push([key, value]); return query }, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: filtered()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: filtered(), error: null }),
    }; return query
  } }
  const source = readFileSync(join(process.cwd(), 'src/app/admin/summary-review-actions.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports: Record<string, unknown> = {}
  vm.runInNewContext(js, { exports, require: (name: string) => {
    if (name === '@/lib/auth') return { requireRole: async (roles: string[]) => { if (role !== 'admin' || !roles.includes('admin')) throw new Error('denied') } }
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    throw new Error('unexpected import')
  } })
  return { action: exports.fetchSummaryReview as (videoId: string) => Promise<{ state: string; current: boolean; findings: Row[] } | null>, queries }
}

test('anonymous and editor are denied before any database access', async () => {
  for (const role of ['anonymous', 'editor'] as const) {
    const { action, queries } = loadAction(role)
    await assert.rejects(() => action('video')); expect(queries).toHaveLength(0)
  }
})

test('admin binds both log keys and excludes other streams and runs', async () => {
  const log = { stream_id: 'stream-1', review_run_id: 'run-1', finding_no: 1, evidence: 'safe' }
  const { action, queries } = loadAction('admin', baseStream, baseRun, [log, { ...log, stream_id: 'other' }, { ...log, review_run_id: 'other' }])
  const result = await action('video')
  expect(result?.findings).toHaveLength(1)
  expect(queries.map(q => q.table)).toEqual(['streams', 'summary_review_runs', 'summary_review_log'])
  expect(queries[0].filters).toEqual([['video_id', 'video']])
  expect(queries[1].filters).toEqual([['stream_id', 'stream-1']])
  expect(queries[2].filters).toEqual([['stream_id', 'stream-1'], ['review_run_id', 'run-1']])
})

test('zero findings, failed, unchanged low, changed high and mixed results use actual version changes', async () => {
  for (const [status, summary, version, state] of [
    ['reviewed_no_change', 'before', 1, 'succeeded'], ['review_failed', 'before', 1, 'failed'],
    ['needs_review', 'before', 1, 'succeeded'], ['auto_fixed', 'after', 2, 'succeeded'],
    ['needs_review', 'after', 2, 'succeeded'],
  ] as const) {
    const { action } = loadAction('admin', { ...baseStream, summary, summary_review_version: version, summary_review_status: status }, { ...baseRun, state, result_payload: { summary, status } })
    const result = await action('video'); expect(result?.current).toBe(true); expect(result?.state).toBe(state); expect(result?.findings).toHaveLength(0)
  }
  expect(await loadAction('admin', baseStream, null).action('video')).toBeNull()
})

test('stale, edits, ABA, confirmation and invalid versions never expose findings', async () => {
  const cases: [Row, Row][] = [
    [baseStream, { ...baseRun, state: 'stale' }],
    [{ ...baseStream, summary: 'edited' }, baseRun], [{ ...baseStream, transcript: 'edited' }, baseRun],
    [{ ...baseStream, summary_review_version: 3 }, baseRun], // edit A→B→A or confirm→unconfirm
    [{ ...baseStream, is_reviewed: true, summary_review_status: 'confirmed', summary_review_version: 2 }, baseRun],
    [{ ...baseStream, summary_review_version: 0 }, baseRun],
    [{ ...baseStream, summary_review_version: '1.0' }, baseRun],
    [{ ...baseStream, summary_review_version: '9007199254740993' }, baseRun],
    [{ ...baseStream, summary_review_version: -1 }, baseRun],
  ]
  for (const [stream, run] of cases) {
    const { action, queries } = loadAction('admin', stream, run, [{ stream_id: 'stream-1', review_run_id: 'run-1' }])
    const result = await action('video'); expect(result?.current).toBe(false); expect(result?.findings).toHaveLength(0)
    expect(queries.map(q => q.table)).toEqual(['streams', 'summary_review_runs'])
  }
})
