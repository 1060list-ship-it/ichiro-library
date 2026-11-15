// Existing artwork is withdrawn while replacements and their access controls
// are prepared. Do not fall back to previously published Storage URLs.
const SHOW_MAGAZINE_COVERS = false
const LOCAL_MAGAZINE_COVERS: Record<string, string> = {}

export function getMagazineCoverUrl(weekLabel: string, fallbackUrl: string | null) {
  return SHOW_MAGAZINE_COVERS ? (LOCAL_MAGAZINE_COVERS[weekLabel] ?? fallbackUrl) : null
}

export function hasLocalMagazineCover(weekLabel: string) {
  return SHOW_MAGAZINE_COVERS && weekLabel in LOCAL_MAGAZINE_COVERS
}
