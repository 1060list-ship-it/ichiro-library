import { expect, test } from '@playwright/test'
import {
  buildAdminInvalidTagDropLog,
  buildAdminTagDropLog,
  getSelectableAdminTags,
  logAdminTagUpdateDrops,
  resolveAdminTagUpdate,
  toAdminTagStorageValue,
  validateAdminTagUpdate,
  type AdminTagVocabularyEntry,
} from '../src/lib/admin-tag-vocabulary'

const vocabulary: AdminTagVocabularyEntry[] = [
  { slug: 'gaming', label: 'ゲーム', is_active: true, sort_order: 10 },
  { slug: 'music_production', label: '音楽制作', is_active: true, sort_order: 20 },
  { slug: 'relationships', label: '人間関係', is_active: false, sort_order: 30 },
]

test('guard accepts active slugs and converts active labels', () => {
  const result = validateAdminTagUpdate([], ['gaming', '音楽制作'], vocabulary)

  expect(result).toEqual({
    tags: ['gaming', 'music_production'],
    droppedInvalidTags: [],
    droppedInactiveTags: [],
  })
})

test('full replacement drops existing inactive and unknown tags with logs', () => {
  const result = validateAdminTagUpdate(
    ['relationships', 'legacy_tag'],
    ['relationships', 'legacy_tag', 'gaming'],
    vocabulary,
  )

  expect(result).toEqual({
    tags: ['gaming'],
    droppedInvalidTags: ['legacy_tag'],
    droppedInactiveTags: ['relationships'],
  })
})

test('guard drops newly added inactive and unknown tags', () => {
  const result = validateAdminTagUpdate([], ['relationships', 'unknown_tag'], vocabulary)

  expect(result.tags).toEqual([])
  expect(result.droppedInvalidTags).toEqual(['unknown_tag'])
  expect(result.droppedInactiveTags).toEqual(['relationships'])
  expect(buildAdminInvalidTagDropLog(result.droppedInvalidTags, 'video-1')).toEqual({
    dropped_invalid_tags: ['unknown_tag'],
    source_path: 'admin_ui',
    video_id: 'video-1',
  })
})

test('guard classifies an inactive Japanese label separately from an unknown tag', () => {
  const result = validateAdminTagUpdate([], ['人間関係', 'unknown_tag'], vocabulary)

  expect(result).toEqual({
    tags: [],
    droppedInvalidTags: ['unknown_tag'],
    droppedInactiveTags: ['relationships'],
  })
  expect(buildAdminTagDropLog(result.droppedInactiveTags, 'video-1')).toEqual({
    dropped_inactive_tags: ['relationships'],
    source_path: 'admin_ui',
    video_id: 'video-1',
  })
})

test('logger emits separate events for an inactive Japanese label and an unknown tag', () => {
  const result = validateAdminTagUpdate([], ['人間関係', 'unknown_tag'], vocabulary)
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)

  try {
    logAdminTagUpdateDrops(result, 'video-1')
  } finally {
    console.warn = originalWarn
  }

  expect(warnings).toEqual([
    [
      'admin_tag_update_dropped_invalid_tags',
      {
        dropped_invalid_tags: ['unknown_tag'],
        source_path: 'admin_ui',
        video_id: 'video-1',
      },
    ],
    [
      'admin_tag_update_dropped_inactive_tags',
      {
        dropped_inactive_tags: ['relationships'],
        source_path: 'admin_ui',
        video_id: 'video-1',
      },
    ],
  ])
})

test('omitted tags preserve the stored value and omit tags from the update', () => {
  expect(resolveAdminTagUpdate(['relationships'], undefined, vocabulary)).toEqual({
    shouldUpdate: false,
    tags: ['relationships'],
    droppedInvalidTags: [],
    droppedInactiveTags: [],
  })
})

test('tags null explicitly clears all tags', () => {
  expect(resolveAdminTagUpdate(['gaming'], null, vocabulary)).toMatchObject({
    shouldUpdate: true,
    tags: [],
    storageValue: null,
  })
})

test('tags empty array explicitly clears all tags', () => {
  expect(resolveAdminTagUpdate(['gaming'], [], vocabulary)).toMatchObject({
    shouldUpdate: true,
    tags: [],
    storageValue: null,
  })
})

test('full replacement observes an existing inactive tag that is dropped', () => {
  expect(resolveAdminTagUpdate(['relationships', 'gaming'], ['music_production'], vocabulary)).toEqual({
    shouldUpdate: true,
    tags: ['music_production'],
    storageValue: ['music_production'],
    droppedInvalidTags: [],
    droppedInactiveTags: ['relationships'],
  })

  expect(buildAdminTagDropLog(['relationships'], 'video-1')).toEqual({
    dropped_inactive_tags: ['relationships'],
    source_path: 'admin_ui',
    video_id: 'video-1',
  })
})

test('tag picker exposes active vocabulary only', () => {
  expect(getSelectableAdminTags(vocabulary).map((entry) => entry.slug)).toEqual([
    'gaming',
    'music_production',
  ])
})

test('empty tag selection is stored as null', () => {
  expect(toAdminTagStorageValue([])).toBeNull()
  expect(toAdminTagStorageValue(['gaming'])).toEqual(['gaming'])
})
