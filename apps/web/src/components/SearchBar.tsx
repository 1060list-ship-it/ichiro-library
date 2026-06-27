'use client'

const SAMPLE_QUERIES = ['2024年3月', '浜田', '浜田 -ゲーム']

type Props = {
  value: string
  onChange: (v: string) => void
  fuzzy: boolean
  onFuzzyChange: (v: boolean) => void
}

export default function SearchBar({ value, onChange, fuzzy, onFuzzyChange }: Props) {
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="人物名・日付・除外検索で探す"
        className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />

      <div className="flex flex-wrap gap-2">
        {SAMPLE_QUERIES.map(sample => (
          <button
            key={sample}
            type="button"
            onClick={() => onChange(sample)}
            className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
          >
            {sample}
          </button>
        ))}
      </div>

      <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">あいまい検索</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${fuzzy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-800 text-gray-400'}`}>
              {fuzzy ? 'ON' : 'OFF'}
            </span>
          </div>
          <p className="text-xs text-gray-500">タイポ・表記ゆれを許容して、近い内容まで広めに探します。</p>
        </div>

        <button
          type="button"
          onClick={() => onFuzzyChange(!fuzzy)}
          aria-pressed={fuzzy}
          className={`relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
            fuzzy ? 'bg-white' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-gray-950 shadow transition-transform ${
              fuzzy ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
