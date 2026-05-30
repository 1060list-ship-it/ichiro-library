import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Entity } from './types'

type LinkableEntity = Pick<Entity, 'slug' | 'name' | 'match_names'>

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

    return (
      <Link
        key={`${entity.slug}-${index}`}
        href={`/entity/${entity.slug}`}
        className="text-indigo-300 underline decoration-indigo-500/40 underline-offset-4 hover:text-indigo-200"
      >
        {part}
      </Link>
    )
  })
}
