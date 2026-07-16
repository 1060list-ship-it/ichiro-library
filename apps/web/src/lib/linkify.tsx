import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Entity } from './types'

type LinkableEntity = Pick<Entity, 'slug' | 'name' | 'match_names'>

// このライブラリの性質上、本文中に自明に頻出しリンクしても情報価値が薄いエンティティ。
// リストが増えて管理が煩雑になる場合は entities.linkify_in_body (boolean, default true) カラムへの移行を検討。
const BODY_LINKIFY_EXCLUDED_SLUGS = ['yamaguchi-ichiro', 'sakanaction']

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function linkifyEntities(text: string | null | undefined, entities: LinkableEntity[]): ReactNode {
  if (!text) return text ?? ''

  const aliases = entities
    .flatMap((entity) =>
      (entity.match_names ?? [])
        .filter((name) => name.length >= 3)
        .map((name) => ({ name, entity }))
    )
    .sort((a, b) => b.name.length - a.name.length)

  if (aliases.length === 0) return text

  const aliasToEntity = new Map<string, LinkableEntity>()
  for (const alias of aliases) {
    if (!aliasToEntity.has(alias.name)) aliasToEntity.set(alias.name, alias.entity)
  }

  const pattern = new RegExp(`(${aliases.map((alias) => escapeRegExp(alias.name)).join('|')})`, 'g')
  const parts = text.split(pattern)
  const hasMatch = parts.some((part) => aliasToEntity.has(part))

  if (!hasMatch) return text

  return parts.map((part, index) => {
    const entity = aliasToEntity.get(part)
    if (!entity) return part

    const displayText = part.startsWith('＊') ? `「${part.slice(1)}」` : part

    return (
      <Link
        key={`${entity.slug}-${index}`}
        href={`/entity/${entity.slug}`}
        className="text-indigo-300 underline decoration-indigo-500/40 underline-offset-4 hover:text-indigo-200"
      >
        {displayText}
      </Link>
    )
  })
}

export function linkifyBody(text: string | null | undefined, entities: LinkableEntity[]): ReactNode {
  return linkifyEntities(text, entities.filter((entity) => !BODY_LINKIFY_EXCLUDED_SLUGS.includes(entity.slug)))
}
