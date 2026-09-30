'use client'

const SAMPLE_QUERIES = ['2024年3月', 'ハマダ', 'ハマダ -ゲーム']

type Props = {
  value: string
  onChange: (v: string) => void
  fuzzy: boolean
  onFuzzyChange: (v: boolean) => void
}

export default function SearchBar({ value, onChange, fuzzy, onFuzzyChange }: Props) {
  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">配信を検索</span>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[var(--muted)]">⌕</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="人物名・話題・日付で探す"
          className="search-bar-input w-full rounded-2xl border py-3 pl-11 pr-4 text-base text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
        />
      </label>
      <div className="search-bar-controls flex flex-wrap items-center justify-between gap-2 px-2 py-2">
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_QUERIES.map(sample => (
            <button
              key={sample}
              type="button"
              onClick={() => onChange(sample)}
              className="min-h-11 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--muted)] transition hover:border-[var(--aqua)] hover:text-[var(--ink)]"
            >
              {sample}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onFuzzyChange(!fuzzy)}
          aria-pressed={fuzzy}
          className="flex min-h-11 items-center gap-2 rounded-full px-2 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <span className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${fuzzy ? 'bg-[var(--aqua)]' : 'bg-[var(--line)]'}`}>
            <span className={`m-0.5 inline-block h-4 w-4 rounded-full bg-[var(--ink)] shadow transition-transform ${fuzzy ? 'translate-x-4' : 'translate-x-0'}`} />
          </span>
          <span>あいまい検索</span>
        </button>
      </div>
    </div>
  )
}
