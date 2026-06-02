# ichiro-library Phase 5: 週刊マガジン v2 実装指示書（Codex向け）

> 設計確定者: kusanagi (Claude Code) — 2026-05-31  
> 実装担当: Codex  
> リポジトリルート: このファイルの2つ上（`ichiro-library/`）

## 目的

週刊マガジンをYouTube配信情報だけでなく、外部メディア（Google News・setlist.fm）の情報も統合して深みのある記事にする。また日曜深夜に管理画面から1クリックでマガジン生成できるようにし、「今週流れた曲」セクションを折りたたみ表示にする。

---

## タスク一覧（順番通りに実施）

### タスク1: `packages/pipeline/fetch_media_news.py` 新規作成

**目的:** Google News RSS + setlist.fm RSS からサカナクション/山口一郎の外部メディア言及を取得する。

**実装要件:**

```python
"""
サカナクション・山口一郎に関する外部メディア情報を取得する。
Google News RSS と setlist.fm RSS を使用（APIキー不要）。
"""
```

- `feedparser` で以下のRSSを取得する
  - Google News（サカナクション）: `https://news.google.com/rss/search?q=%E3%82%B5%E3%82%AB%E3%83%8A%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%B3&hl=ja&gl=JP&ceid=JP:ja`
  - Google News（山口一郎）: `https://news.google.com/rss/search?q=%E5%B1%B1%E5%8F%A3%E4%B8%80%E9%83%8E+%E3%82%B5%E3%82%AB%E3%83%8A%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%B3&hl=ja&gl=JP&ceid=JP:ja`
  - setlist.fm: `https://www.setlist.fm/search?query=Sakanaction&rss`（取得できない場合はスキップしてログに残す）

- `fetch_media_news(week_start: date, week_end: date) -> list[dict]` 関数を公開する
- 各エントリを以下の形式で返す:
  ```python
  {
    "title": "記事タイトル",
    "source": "メディア名（Google News / setlist.fm）",
    "url": "URL",
    "published": "YYYY-MM-DD",  # date文字列
    "snippet": "本文の抜粋（あれば、なければ空文字）",
  }
  ```
- `week_start` 〜 `week_end` の範囲外エントリはフィルタリングして除外する
- `pubDate` のパースは `email.utils.parsedate_to_datetime` + `.date()` を使う
- 重複URL除去（同じURLが複数フィードに出た場合は1件だけ残す）
- エラー時はその RSS ソースのみスキップ、他は継続する
- `requests.get(timeout=10)` でフェッチし、失敗はログに記録してスキップ

---

### タスク2: `packages/pipeline/requirements.txt` に `feedparser` 追加

```
feedparser>=6.0.0
```

既存行の末尾に追記する。

---

### タスク3: `packages/pipeline/weekly_magazine.py` 改修

**目的:** 外部メディア情報をGeminiプロンプトに渡してtopicsに統合させる。

**変更箇所:**

#### 3-1: インポート追加

```python
from fetch_media_news import fetch_media_news
```

#### 3-2: `MAGAZINE_PROMPT` を更新

`### 前週のコンテキスト（参考）` セクションの直前に以下を追加:

```
### 今週の外部メディア情報（Google News・setlist.fm）
{media_news_json}
```

プロンプト末尾の注意事項に以下を追記:

```
- 外部メディア情報がある場合はtopicsに自然に統合すること（「ニュースによると」等の引用形式は不要、ファクトとして使う）
- ライブセットリスト情報（setlist.fm）があれば songsセクションに加える（ただし配信で流れた曲と重複排除すること）
- 外部情報が少ない or 関連性が薄い場合は無理に使わなくてよい
```

#### 3-3: `generate_magazine()` 関数内でメディア情報を取得してプロンプトに渡す

`streams_res` 取得後、Gemini呼び出し前に以下を追加:

```python
# 外部メディア情報を取得
try:
    media_mentions = fetch_media_news(monday, sunday)
    logger.info(f"[{label}] 外部メディア情報 {len(media_mentions)} 件取得")
except Exception as e:
    logger.warning(f"[{label}] 外部メディア情報取得失敗（スキップ）: {e}")
    media_mentions = []

media_news_json = json.dumps(media_mentions, ensure_ascii=False, indent=2) if media_mentions else "（今週は外部メディア情報なし）"
```

`prompt = MAGAZINE_PROMPT.format(...)` の `format` 引数に `media_news_json=media_news_json` を追加する。

---

### タスク4: DB migration `supabase/migrations/011_pipeline_jobs_weekly_magazine.sql`

`pipeline_jobs.kind` の CHECK 制約に `'weekly_magazine'` を追加する。

```sql
-- pipeline_jobs.kind に weekly_magazine を追加
ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;
ALTER TABLE pipeline_jobs
  ADD CONSTRAINT pipeline_jobs_kind_check
  CHECK (kind IN ('fetch_new', 'reprocess', 'reprocess_single', 'weekly_magazine'));
```

migration ファイルを作成後、`supabase db push` を実行して適用する。

---

### タスク5: `packages/pipeline/worker.py` に `weekly_magazine` 対応追加

**インポート追加:**

```python
from weekly_magazine import generate_magazine
```

**`run_job()` 関数内に分岐追加:**

```python
if kind == "weekly_magazine":
    from datetime import date as _date
    target_str = payload.get("date")
    target = _date.fromisoformat(target_str) if target_str else None
    generate_magazine(target_date=target)
    return
```

既存の `raise ValueError("Unknown job kind: %s" % kind)` の直前に追加する。

---

### タスク6: `apps/web/src/app/admin/actions.ts` に `weekly_magazine` 追加

**`EnqueueJobInput` 型に追記:**

```typescript
export type EnqueueJobInput =
  | { kind: 'fetch_new'; days?: number; maxVideos?: number }
  | { kind: 'reprocess' }
  | { kind: 'reprocess_single'; videoId: string }
  | { kind: 'weekly_magazine'; date?: string }  // ← 追加
```

**`enqueueJob()` 関数内の `row` 生成部分を更新:**

`kind === 'fetch_new'` の payload 生成の else 側を、`weekly_magazine` の date を渡せるよう修正:

```typescript
const row = {
  kind: input.kind,
  video_id: input.kind === 'reprocess_single' ? input.videoId : null,
  payload: input.kind === 'fetch_new'
    ? { days: input.days ?? 30, max_videos: input.maxVideos ?? 20 }
    : input.kind === 'weekly_magazine' && input.date
    ? { date: input.date }
    : null,
}
```

---

### タスク7: `apps/web/src/app/admin/AdminPageClient.tsx` にマガジン生成ボタン追加

**目的:** 管理画面からワンクリックでマガジン生成ジョブをキューに入れられるようにする。

既存の「パイプライン操作」セクション（`enqueueJob` ボタンが並んでいる箇所）に、以下のボタンを追加する:

- ボタンラベル: `「今週のマガジンを生成」`
- クリック時: `enqueueJob({ kind: 'weekly_magazine' })`
- `isPending` 時: `「生成キューに登録中...」`
- ボタンのスタイル: 既存の他ボタンに揃える

`kindLabel` のマッピングに追加:
```typescript
if (kind === 'weekly_magazine') return 'マガジン生成'
```

---

### タスク8: `apps/web/src/app/magazine/[week]/page.tsx` の `SongsSection` 折りたたみ化

**目的:** 「今週流れた曲」セクションをデフォルトで折りたたみ、クリックで展開できるようにする。

**現在の `SongsSection` 実装（lines 205–257）を以下のように書き換える:**

- `useState` は既にファイル上部でインポート済みのはず。なければ追加する
- `const [open, setOpen] = useState(false)` でデフォルトは折りたたみ
- セクションヘッダーを `<button>` にして、クリックで `open` をトグル
- ヘッダー表示: `今週流れた曲（{songs.length}曲）▼` / `今週流れた曲（{songs.length}曲）▲`
- `open` が `false` のとき曲リストを非表示（`hidden` クラス or 条件レンダリング）
- 既存の曲リスト表示ロジック（番号・曲名・YouTubeリンク）は変更しない

実装例:

```tsx
function SongsSection({ songs, streamMap, entities }: ...) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left"
      >
        <SectionHeading>
          今週流れた曲（{songs.length}曲） {open ? '▲' : '▼'}
        </SectionHeading>
      </button>
      {open && (
        <div className="bg-gray-900 rounded-xl overflow-hidden divide-y divide-gray-800/60">
          {songs.map((s, i) => { /* 既存のレンダリングロジックをそのままここに */ })}
        </div>
      )}
    </section>
  )
}
```

---

### タスク9: `README.md` に日曜深夜cron登録手順を追記

Phase 4 の cron セクションに以下を追記する:

```markdown
### 日曜深夜のマガジン自動生成

毎週日曜 23:30 に `weekly_magazine` ジョブをキューに投入し、worker.py が処理する。

```bash
# crontab -e で以下を追加

# 毎週日曜 23:30 にマガジン生成ジョブをキューに登録
30 23 * * 0 cd /path/to/ichiro-library/packages/pipeline && python -c "
from store import get_supabase_client
client = get_supabase_client()
client.table('pipeline_jobs').insert({'kind': 'weekly_magazine'}).execute()
print('weekly_magazine job enqueued')
" >> /tmp/ichiro-enqueue.log 2>&1

# worker.py はすでに */15 で動いているので自動的に処理される
```

または管理画面の「今週のマガジンを生成」ボタンから手動実行も可能。
```

---

## 完了確認チェックリスト

- [ ] `fetch_media_news.py` を単体で `python fetch_media_news.py` して結果が出力されることを確認
- [ ] `requirements.txt` に `feedparser` が追加されている
- [ ] `weekly_magazine.py --dry-run` 相当（または実際に生成）して外部メディア情報がプロンプトに入ることをログで確認
- [ ] `supabase/migrations/011_pipeline_jobs_weekly_magazine.sql` が作成されている
- [ ] `supabase db push` で migration が適用されている（`cd /Users/ikkiair/Projects/AI_work/03_personal_projects/ichiro-library && supabase db push`）
- [ ] `worker.py` に `weekly_magazine` の分岐が追加されている
- [ ] `actions.ts` の `EnqueueJobInput` に `weekly_magazine` が追加されている
- [ ] 管理画面に「今週のマガジンを生成」ボタンが表示されている
- [ ] 「今週流れた曲」セクションがデフォルトで折りたたまれていて、クリックで展開できる
- [ ] `README.md` に日曜cron手順が追記されている

---

## 重要な制約・注意事項

1. **Secret の扱い:** `.env.local` の値はログ・コメント・出力に絶対に出力しない
2. **既存スクリプトを変更しない:** `batch_runner.py`, `reprocess_videos.py` の関数シグネチャは変えるな
3. **Python 3.9 互換:** 型ヒントで `X | None` は使わず `Optional[X]` を使う
4. **feedparser の pubDate:** Google News の pubDate は RFC 2822 形式。`email.utils.parsedate_to_datetime` でパースする
5. **Google News RSS のURL制限:** User-Agent を設定しないとブロックされることがある。`requests.get(url, headers={"User-Agent": "ichiro-library/1.0"}, timeout=10)` を使う
6. **SongsSection の `useState`:** `page.tsx` は既に `'use client'` または Client Component のはず。インポート済みなら追加不要
7. **`supabase db push` はリポジトリルートから実行する**
