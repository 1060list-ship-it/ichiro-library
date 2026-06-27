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
    <div className="space-y-1.5">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="人物名・日付・除外検索で探す"
        className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />
      <div className="flex items-center justify-between px-1">
        <div className="flex gap-3">
          {SAMPLE_QUERIES.map(sample => (
            <button
              key={sample}
              type="button"
              onClick={() => onChange(sample)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onFuzzyChange(!fuzzy)}
          aria-pressed={fuzzy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full transition-colors ${fuzzy ? 'bg-blue-500' : 'bg-gray-700'}`}>
            <span className={`inline-block h-3 w-3 m-0.5 rounded-full bg-white shadow transition-transform ${fuzzy ? 'translate-x-3' : 'translate-x-0'}`} />
          </span>
          <span>あいまい</span>
        </button>
      </div>
    </div>
  )
}
