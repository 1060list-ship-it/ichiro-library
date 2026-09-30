/** 検索ログ集計用のクエリ正規化。検索動作自体には影響しない。 */

function isValidDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }

  const date = new Date(year, month - 1, day)

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function normalizeSearchQueryForStats(query: string): string {
  const normalized = query.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return normalized
  }

  const fullMatch = normalized.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?\s*[-/.]?\s*(\d{1,2})\s*日?$/)
    ?? normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
    ?? normalized.match(/^(\d{4})\s+(\d{1,2})\s+(\d{1,2})$/)
    ?? normalized.match(/^(\d{4})\s+(\d{2})(\d{2})$/)
    ?? normalized.match(/^(\d{4})(\d{2})[-/.](\d{1,2})$/)
  if (fullMatch) {
    const year = Number(fullMatch[1])
    const month = Number(fullMatch[2])
    const day = Number(fullMatch[3])
    if (isValidDateParts(year, month, day)) {
      return `${year}年${month}月${day}日`
    }
  }

  const ymMatch = normalized.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/)
  if (ymMatch) {
    const year = Number(ymMatch[1])
    const month = Number(ymMatch[2])
    if (month >= 1 && month <= 12) {
      return `${year}年${month}月`
    }
  }

  const mdMatch = normalized.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/)
    ?? normalized.match(/^(\d{1,2})\s+(\d{1,2})$/)
  if (mdMatch) {
    const month = Number(mdMatch[1])
    const day = Number(mdMatch[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${month}月${day}日`
    }
  }

  const jpMdMatch = normalized.match(/^(\d{1,2})月(?:(\d{1,2})日?)?$/)
  if (jpMdMatch) {
    const month = Number(jpMdMatch[1])
    const day = jpMdMatch[2] === undefined ? null : Number(jpMdMatch[2])
    if (month >= 1 && month <= 12 && (day === null || (day >= 1 && day <= 31))) {
      return day === null ? `${month}月` : `${month}月${day}日`
    }
  }

  return normalized
}
