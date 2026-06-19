'use client'

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
        placeholder="キーワードで検索… 除外は -キーワード"
        className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-gray-500">あいまい検索</span>
        <button
          type="button"
          onClick={() => onFuzzyChange(!fuzzy)}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
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
