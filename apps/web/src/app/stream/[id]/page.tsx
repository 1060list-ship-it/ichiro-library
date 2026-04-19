'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Stream, Chapter } from '@/lib/types'
import ChapterList from '@/components/ChapterList'

export default function StreamPage() {
  const { id } = useParams<{ id: string }>()
  const [stream, setStream] = useState<Stream | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from('streams').select('*').eq('video_id', id).single() as { data: import('@/lib/types').Stream | null }
      if (s) {
        setStream(s)
        const { data: c } = await supabase
          .from('chapters')
          .select('*')
          .eq('stream_id', s.id)
          .order('sort_order')
        if (c) setChapters(c)
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">読み込み中...</div>
  if (!stream) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">配信が見つかりません</div>

  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">← 一覧に戻る</Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* YouTube埋め込み */}
        <div className="aspect-video w-full">
          <iframe
            src={`https://www.youtube.com/embed/${stream.video_id}`}
            className="w-full h-full rounded-lg"
            allowFullScreen
          />
        </div>

        {/* メタデータ */}
        <div className="space-y-2">
          <p className="text-sm text-gray-400">{date}</p>
          <h1 className="text-lg font-bold leading-snug">{stream.title}</h1>
          <div className="flex gap-4 text-sm text-gray-400">
            {stream.view_count && <span>再生 {stream.view_count.toLocaleString()}</span>}
            {stream.duration_min && <span>{stream.duration_min}分</span>}
          </div>
        </div>

        {/* タグ */}
        {(stream.tags?.length || stream.corner_names?.length || stream.guests?.length) ? (
          <div className="flex flex-wrap gap-2">
            {stream.corner_names?.map(c => (
              <span key={c} className="text-xs bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded-full">{c}</span>
            ))}
            {stream.guests?.map(g => (
              <span key={g} className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">{g}</span>
            ))}
            {stream.tags?.map(t => (
              <span key={t} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        ) : null}

        {/* AI要約 */}
        {stream.summary && (
          <div className="bg-gray-900 rounded-lg p-4 space-y-1">
            <p className="text-xs text-gray-500 font-medium">AI要約</p>
            <p className="text-sm text-gray-200 leading-relaxed">{stream.summary}</p>
          </div>
        )}

        {/* チャプター */}
        {chapters.length > 0 && <ChapterList chapters={chapters} videoId={stream.video_id} />}
      </div>
    </main>
  )
}
