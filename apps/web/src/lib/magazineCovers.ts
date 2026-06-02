const LOCAL_MAGAZINE_COVERS: Record<string, string> = {
  '2026-W18': '/magazine-covers/2026-W18.png',
  '2026-W19': '/magazine-covers/2026-W19.png',
  '2026-W20': '/magazine-covers/2026-W20.png',
  '2026-W21': '/magazine-covers/2026-W21.png',
}

export function getMagazineCoverUrl(weekLabel: string, fallbackUrl: string | null) {
  return LOCAL_MAGAZINE_COVERS[weekLabel] ?? fallbackUrl
}

export function hasLocalMagazineCover(weekLabel: string) {
  return weekLabel in LOCAL_MAGAZINE_COVERS
}
