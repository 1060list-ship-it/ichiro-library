export type AdminTagVocabularyEntry = {
  slug: string
  label: string
  is_active: boolean
  sort_order: number
}

export type AdminTagValidationResult = {
  tags: string[]
  droppedInvalidTags: string[]
  droppedInactiveTags: string[]
}

export type AdminTagUpdateResolution = AdminTagValidationResult & {
  shouldUpdate: boolean
  storageValue?: string[] | null
}

export function buildAdminTagDropLog(droppedInactiveTags: string[], videoId: string) {
  return {
    dropped_inactive_tags: droppedInactiveTags,
    source_path: 'admin_ui',
    video_id: videoId,
  }
}

export function buildAdminInvalidTagDropLog(droppedInvalidTags: string[], videoId: string) {
  return {
    dropped_invalid_tags: droppedInvalidTags,
    source_path: 'admin_ui',
    video_id: videoId,
  }
}

export function logAdminTagUpdateDrops(
  result: Pick<AdminTagValidationResult, 'droppedInvalidTags' | 'droppedInactiveTags'>,
  videoId: string,
) {
  if (result.droppedInvalidTags.length > 0) {
    console.warn(
      'admin_tag_update_dropped_invalid_tags',
      buildAdminInvalidTagDropLog(result.droppedInvalidTags, videoId),
    )
  }

  if (result.droppedInactiveTags.length > 0) {
    console.warn(
      'admin_tag_update_dropped_inactive_tags',
      buildAdminTagDropLog(result.droppedInactiveTags, videoId),
    )
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function validateAdminTagUpdate(
  existingTags: string[] | null,
  requestedTags: string[],
  vocabulary: AdminTagVocabularyEntry[],
): AdminTagValidationResult {
  const existing = new Set(existingTags ?? [])
  const activeBySlug = new Map(
    vocabulary.filter((entry) => entry.is_active).map((entry) => [entry.slug, entry.slug]),
  )
  const activeByLabel = new Map(
    vocabulary.filter((entry) => entry.is_active).map((entry) => [entry.label, entry.slug]),
  )
  const inactiveSlugs = new Set(
    vocabulary.filter((entry) => !entry.is_active).map((entry) => entry.slug),
  )
  const inactiveByLabel = new Map(
    vocabulary.filter((entry) => !entry.is_active).map((entry) => [entry.label, entry.slug]),
  )
  const knownSlugs = new Set(vocabulary.map((entry) => entry.slug))

  const tags: string[] = []
  const droppedInvalidTags: string[] = []
  const requestedInactiveTags: string[] = []

  for (const requestedTag of unique(requestedTags)) {
    const inactiveSlug = inactiveSlugs.has(requestedTag)
      ? requestedTag
      : inactiveByLabel.get(requestedTag)
    if (inactiveSlug) {
      requestedInactiveTags.push(inactiveSlug)
      continue
    }

    const activeSlug = activeBySlug.get(requestedTag) ?? activeByLabel.get(requestedTag)
    if (activeSlug) {
      tags.push(activeSlug)
    } else {
      droppedInvalidTags.push(requestedTag)
    }
  }

  return {
    tags: unique(tags),
    droppedInvalidTags: unique([
      ...droppedInvalidTags,
      ...[...existing].filter((tag) => !knownSlugs.has(tag) && !tags.includes(tag)),
    ]),
    droppedInactiveTags: unique(
      [
        ...requestedInactiveTags,
        ...[...existing].filter((tag) => inactiveSlugs.has(tag) && !tags.includes(tag)),
      ],
    ),
  }
}

export function resolveAdminTagUpdate(
  existingTags: string[] | null,
  requestedTags: string[] | null | undefined,
  vocabulary: AdminTagVocabularyEntry[],
): AdminTagUpdateResolution {
  if (requestedTags === undefined) {
    return {
      shouldUpdate: false,
      tags: existingTags ?? [],
      droppedInvalidTags: [],
      droppedInactiveTags: [],
    }
  }

  const validation = validateAdminTagUpdate(existingTags, requestedTags ?? [], vocabulary)
  return {
    ...validation,
    shouldUpdate: true,
    storageValue: toAdminTagStorageValue(validation.tags),
  }
}

export function getSelectableAdminTags(vocabulary: AdminTagVocabularyEntry[]) {
  return vocabulary.filter((entry) => entry.is_active)
}

export function toAdminTagStorageValue(tags: string[]) {
  return tags.length > 0 ? tags : null
}
