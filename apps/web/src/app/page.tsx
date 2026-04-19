'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Stream } from '@/lib/types'
import StreamCard from '@/components/StreamCard'
import SearchBar from '@/components/SearchBar'

export default function Home() {
  const [streams, setStreams] = useState<Stream[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    fetchStreams()
  }, [debouncedQuery])

  async function fetchStreams() {
    setLoading(true)
    let q = supabase
      .from('streams')
      .select('*')
      .order('stream_date', { ascending: false })

    if (debouncedQuery.trim()) {
      q = q.or(`title.ilike.%${debouncedQuery}%,summary.ilike.%${debouncedQuery}%`)
    }

    const { data, error } = await q
    if (!error && data) setStreams(data)
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4">
        <h1 className="text-xl font-bold tracking-wide">ichiro library</h1>
        <p className="text-xs text-gray-400 mt-0.5">山口一郎 YouTubeライブ アーカイブ</p>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <SearchBar value={query} onChange={setQuery} />

        {loading ? (
          <p className="text-center text-gray-500 py-12">読み込み中...</p>
        ) : streams.length === 0 ? (
          <p className="text-center text-gray-500 py-12">該当する配信が見つかりません</p>
        ) : (
          <div className="space-y-4">
            {streams.map(stream => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
