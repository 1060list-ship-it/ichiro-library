export function normalizeSongTitle(title: string): string {
  return title.normalize('NFKC').trim().toLowerCase()
}
