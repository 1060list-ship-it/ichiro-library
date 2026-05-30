# 山口一郎 YouTubeライブ ライブラリ検索システム — 最終仕様書

> **目的**: このドキュメントはClaude Code での実装引き継ぎ用の完全仕様書である。  
> **作成日**: 2026-04-18  
> **ステータス**: 設計完了・実装待ち

---

## 1. プロジェクト概要

### 1.1 ゴール
山口一郎（サカナクション）のYouTubeチャンネル `@ichiroyamaguchichannel` のライブ配信アーカイブを自動収集・構造化し、ファン数名で共有できるライブラリ検索Webアプリを構築する。

### 1.2 対象チャンネル
- URL: https://www.youtube.com/@ichiroyamaguchichannel/streams
- 配信頻度: 週1〜2回（推定）
- 配信時間: 1回あたり60〜120分程度

### 1.3 ユーザー
- **管理者（オーナー）**: 1名。AI要約の確認・修正、システム管理。
- **閲覧ユーザー（ファン）**: 数名。URL共有でブラウザから検索・閲覧。

---

## 2. システムアーキテクチャ

### 2.1 全体構成

```
[YouTube Data API v3]
       │
       ▼
[自動巡回バッチ] ──週1実行──┐
       │                      │
       ▼                      │
[字幕取得]                    │
  youtube-transcript-api      │
  └→ Supadata (fallback)     │
  └→ Whisper API (fallback)  │
       │                      │
       ▼                      │
[AI要約・構造化]              │
  Gemini 1.5 Flash            │
       │                      │
       ▼                      │
[Supabase PostgreSQL] ◄───────┘
       │
       ▼
[検索UI: React on Vercel]
  └→ URL共有でファンがブラウザで即アクセス
```

### 2.2 技術スタック

| レイヤー | 技術 | 用途 |
|----------|------|------|
| データ収集 | YouTube Data API v3 | メタデータ（タイトル、再生数、コメント数、サムネイル） |
| 字幕取得 | `youtube-transcript-api` (Python) | アーカイブ動画の自動生成字幕をタイムスタンプ付きで取得 |
| 字幕フォールバック① | Supadata API | youtube-transcript-api失敗時のAI fallback付き代替 |
| 字幕フォールバック② | OpenAI Whisper API | 上記すべて失敗時の音声ダウンロード→文字起こし |
| AI要約 | Google Gemini 1.5 Flash | 概要生成、チャプター抽出、タグ/コーナー名/ゲスト名抽出 |
| データベース | Supabase (PostgreSQL) | 全データ蓄積、全文検索、API提供 |
| フロントエンド | React + Tailwind CSS | 検索UI |
| ホスティング | Vercel | 静的サイト + Edge Functions |
| 自動化 | Supabase Edge Functions or GAS | 週次バッチ実行 |

---

## 3. データベース設計

### 3.1 テーブル: `streams`（配信）

```sql
CREATE TABLE streams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  stream_date     DATE NOT NULL,
  duration_min    INTEGER,
  view_count      INTEGER,                -- 初回取得時の再生数
  view_count_7d   INTEGER,                -- 7日後の再取得値
  comment_count   INTEGER,
  summary         TEXT,                   -- AI生成の概要（200-400字）
  tags            TEXT[],                 -- 汎用タグ
  corner_names    TEXT[],                 -- コーナー名（#未知との遭遇, #深夜対談 等）
  guests          TEXT[],                 -- ゲスト名
  transcript      TEXT,                   -- 全文テキスト（検索用、UIには非表示）
  youtube_url     TEXT,
  thumbnail_url   TEXT,
  status          TEXT DEFAULT 'public',  -- public / unlisted / deleted
  channel_id      TEXT DEFAULT 'ichiroyamaguchichannel', -- 将来の多チャンネル対応
  ai_model        TEXT,                   -- 要約に使用したモデル名
  ai_prompt_ver   TEXT,                   -- プロンプトバージョン
  is_reviewed     BOOLEAN DEFAULT false,  -- 管理者が手動確認済みか
  avg_rating      NUMERIC(2,1) DEFAULT 0, -- 星評価の平均（1.0-5.0）
  rating_count    INTEGER DEFAULT 0,      -- 評価数
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 全文検索インデックス（日本語対応）
-- 注: Supabaseのデフォルトでは日本語トークナイザが限定的。
-- pg_bigm拡張 or pgroonga拡張の有効化を検討。
-- 最低限 trigram (pg_trgm) を使用する。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_streams_title_trgm ON streams USING gin(title gin_trgm_ops);
CREATE INDEX idx_streams_summary_trgm ON streams USING gin(summary gin_trgm_ops);
CREATE INDEX idx_streams_transcript_trgm ON streams USING gin(transcript gin_trgm_ops);
CREATE INDEX idx_streams_tags ON streams USING gin(tags);
CREATE INDEX idx_streams_corner_names ON streams USING gin(corner_names);
CREATE INDEX idx_streams_guests ON streams USING gin(guests);
CREATE INDEX idx_streams_date ON streams(stream_date DESC);
```

### 3.2 テーブル: `chapters`（チャプター）

```sql
CREATE TABLE chapters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID REFERENCES streams(id) ON DELETE CASCADE,
  start_sec   INTEGER NOT NULL,         -- 開始秒数（YouTubeジャンプ用）
  end_sec     INTEGER,                  -- 終了秒数（次チャプター開始 or 動画終了）
  title       TEXT NOT NULL,            -- "未知との遭遇コーナー"
  summary     TEXT,                     -- そのチャプターの要約（50-100字）
  transcript_segment TEXT,              -- そのチャプター区間の字幕テキスト（検索用）
  sort_order  INTEGER NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chapters_stream ON chapters(stream_id);
CREATE INDEX idx_chapters_segment_trgm ON chapters USING gin(transcript_segment gin_trgm_ops);
```

### 3.3 テーブル: `ratings`（星評価）

```sql
CREATE TABLE ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID REFERENCES streams(id) ON DELETE CASCADE,
  user_hash   TEXT NOT NULL,            -- ブラウザフィンガープリントのハッシュ（匿名）
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stream_id, user_hash)          -- 1ユーザー1配信1評価
);

CREATE INDEX idx_ratings_stream ON ratings(stream_id);
```

### 3.4 将来拡張用（今は作成しない、スキーマ案のみ記録）

```sql
-- セマンティック検索用（将来）
-- ALTER TABLE streams ADD COLUMN embedding vector(1536);

-- お気に入り機能（将来）
-- CREATE TABLE favorites (
--   id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   stream_id UUID REFERENCES streams(id),
--   user_hash TEXT NOT NULL,
--   UNIQUE(stream_id, user_hash)
-- );

-- 配信間の関連リンク（将来）
-- CREATE TABLE related_streams (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   stream_id_a UUID REFERENCES streams(id),
--   stream_id_b UUID REFERENCES streams(id),
--   relation    TEXT  -- 'sequel', 'same_topic', 'same_guest'
-- );
```

---

## 4. 字幕取得パイプライン

### 4.1 フォールバック戦略（3段階）

```
Step 1: youtube-transcript-api
  │ 成功 → 字幕テキスト取得完了
  │ 失敗（TranscriptsDisabled, NoTranscriptFound等）
  ▼
Step 2: Supadata API（AI fallback付き）
  │ 成功 → 字幕テキスト取得完了
  │ 失敗
  ▼
Step 3: Whisper API（音声DL → 文字起こし）
  │ 成功 → 字幕テキスト取得完了
  │ 失敗
  ▼
Step 4: status = 'transcript_failed' でDB登録
  → 管理画面から手動で再処理トリガー可能
```

### 4.2 youtube-transcript-api の使い方

```python
from youtube_transcript_api import YouTubeTranscriptApi

ytt_api = YouTubeTranscriptApi()

# 利用可能な字幕一覧
transcript_list = ytt_api.list(video_id)

# 日本語自動字幕を取得（タイムスタンプ付き）
transcript = ytt_api.fetch(video_id, languages=['ja'])

# 結果: transcript.snippets = [
#   FetchedTranscriptSnippet(text='こんばんは', start=0.0, duration=2.5),
#   FetchedTranscriptSnippet(text='今日は...', start=2.5, duration=3.0),
#   ...
# ]
```

### 4.3 重要な制約と注意点

| 制約 | 詳細 | 対応 |
|------|------|------|
| ライブ配信中の自動字幕は日本語未対応 | 配信終了後のVODアーカイブ化で日本語自動字幕が生成される | バッチは配信から24時間以上後に実行 |
| youtube-transcript-apiは非公式 | YouTubeの仕様変更で動作しなくなるリスク | Supadata（有料）をフォールバックとして確保 |
| 公式Captions APIは自分の動画のみ | OAuth認証が必要で、他人の動画の字幕はDL不可 | 非公式APIを使用（個人・非商用利用） |
| 字幕の精度 | YouTube自動字幕は誤変換がある（特に固有名詞） | AI要約段階でプロンプトに辞書を含めて補正 |

---

## 5. AI要約設計

### 5.1 使用モデル
- **Gemini 1.5 Flash**（Google AI Studio経由）
- 理由: 100万トークンのコンテキスト窓、日本語精度が高い、無料枠あり、コスト最安

### 5.2 プロンプト設計

```
あなたは山口一郎のYouTubeライブ配信を分析するアシスタントです。

## 入力
以下は配信のタイムスタンプ付き字幕テキストです。

## タスク
以下の情報を抽出・生成してJSON形式で返してください。

### 1. summary（概要）
配信全体の内容を200-400字で要約してください。

### 2. chapters（チャプター）
話題の変わり目を検出し、10分以上同じ話題が続く場合を1チャプターとしてください。
各チャプターに以下を含めてください:
- start_sec: 開始秒数
- title: チャプタータイトル（20字以内）
- summary: そのチャプターの要約（50-100字）

### 3. corner_names（コーナー名）
配信内で言及されたコーナー名を抽出してください。
既知のコーナー名リスト（部分一致でOK）:
- 未知との遭遇
- 深夜対談
- [他にもあれば追加]

### 4. guests（ゲスト名）
配信に登場したゲストのフルネームを抽出してください。

### 5. tags（タグ）
配信の内容を表すタグを3-8個生成してください。
タイトルや説明文のハッシュタグも含めてください。

## 固有名詞辞書（字幕の誤変換補正用）
- サカナクション（バンド名）
- 山口一郎（やまぐちいちろう）
- 新宝島（しんたからじま、楽曲名）
- 目が明く藍色（めがあくあいいろ、楽曲名）
- [運用しながら追加していく]

## 出力フォーマット
JSONのみを返してください。マークダウンのコードブロックは不要です。
```

### 5.3 プロンプトバージョン管理
- `ai_prompt_ver` カラムで使用したプロンプトのバージョンを記録
- プロンプト本体は `/prompts/v1.txt` 等のファイルで管理
- プロンプト改善時は新バージョンとして追加し、既存データの再処理可否を判断

---

## 6. 検索UI設計

### 6.1 技術構成
- **フレームワーク**: React (Next.js App Router)
- **スタイリング**: Tailwind CSS
- **デプロイ**: Vercel
- **APIアクセス**: Supabase JavaScript Client (`@supabase/supabase-js`)
- **URL**: `ichiro-library.vercel.app`（仮）

### 6.2 ページ構成

```
/ (トップ)
  ├── 検索バー（キーワード検索）
  ├── フィルター
  │   ├── 日付範囲（DatePicker）
  │   ├── コーナー名（チップ選択）
  │   ├── ゲスト名（チップ選択）
  │   └── タグ（チップ選択）
  ├── ソート
  │   ├── 配信日（新しい順/古い順）
  │   ├── 再生数
  │   └── 評価（星の平均）
  ├── ランキングセクション（高評価TOP10）
  └── 配信一覧（カード形式）

/stream/:video_id (配信詳細)
  ├── サムネイル + YouTube埋め込みプレーヤー
  ├── メタデータ（日付、再生数、コメント数、配信時間）
  ├── 星評価（閲覧者が評価可能、1配信1評価）
  ├── AI要約（概要テキスト）
  ├── タグ・コーナー名・ゲスト名（クリックでフィルタ）
  └── チャプター一覧
      ├── 時間 | タイトル | 要約
      └── 時間クリック → YouTube該当箇所にジャンプ
           （youtube.com/watch?v={id}&t={start_sec}）

/admin (管理画面 ※パスワード保護)
  ├── 未レビュー配信一覧（is_reviewed = false）
  ├── AI要約の確認・手動編集
  │   ├── summary の編集
  │   ├── chapters の追加・削除・並替
  │   ├── tags / corner_names / guests の編集
  │   └── 「確認済み」ボタン（is_reviewed = true に更新）
  ├── 処理失敗した配信の再処理トリガー
  └── 統計（登録済み配信数、未レビュー数、直近の処理ログ）
```

### 6.3 検索ロジック

```
キーワード検索:
  → streams.title ILIKE '%keyword%'
  → streams.summary ILIKE '%keyword%'
  → chapters.title ILIKE '%keyword%'
  → chapters.transcript_segment ILIKE '%keyword%'
  ※ pg_trgmのsimilarity + ILIKEを組み合わせ
  ※ ヒットしたチャプターの前後50文字をスニペット表示（KWIC）

日付フィルタ:
  → streams.stream_date BETWEEN :start AND :end

タグ/コーナー/ゲストフィルタ:
  → streams.tags @> ARRAY['指定タグ']
  → streams.corner_names @> ARRAY['指定コーナー']
  → streams.guests @> ARRAY['指定ゲスト']
```

### 6.4 星評価ロジック

```
ユーザー識別:
  → ブラウザのlocalStorageにランダムUUID生成・保持
  → そのUUIDのSHA256ハッシュを user_hash として使用
  → 同一ブラウザから同一配信へは1回のみ評価可能（UNIQUE制約）

評価後の処理:
  → ratings テーブルにINSERT
  → streams.avg_rating と rating_count をトリガー or アプリ側で更新

ランキング:
  → avg_rating DESC, rating_count DESC でソート
  → rating_count >= 3 の配信のみランキング対象（少数評価でのブレ防止）
```

### 6.5 著作権対応
- `transcript`（字幕全文）はDB内部の検索インデックスとしてのみ使用
- **UIには字幕全文を表示しない**
- 表示するのは: AI生成の要約、チャプタータイトル・要約のみ
- YouTubeプレーヤーは公式iframe埋め込みを使用

---

## 7. 自動巡回バッチ設計

### 7.1 実行頻度
- **週1回**（日曜深夜 or 月曜早朝）
- 配信から24時間以上経過後に処理（自動字幕生成を待つため）

### 7.2 処理フロー

```
1. YouTube Data API で最新動画一覧を取得
   → チャンネルID指定、publishedAfter で前回実行日以降に絞り込み

2. 既にDBに存在する video_id を除外（新着のみ処理）

3. 各新着動画に対して:
   a. メタデータ取得（タイトル、再生数、コメント数、配信時間、サムネイル）
   b. 字幕取得（3段階フォールバック）
   c. AI要約・構造化（Gemini 1.5 Flash）
   d. DB登録（streams + chapters）
   e. is_reviewed = false で登録

4. 7日前の配信のview_count_7dを再取得・更新

5. 処理結果のログをDB or ファイルに記録
```

### 7.3 エラーハンドリング
- 字幕取得失敗: `status = 'transcript_failed'` でDB登録、管理画面で再処理可能
- AI要約失敗: `status = 'summary_failed'` でDB登録、字幕テキストはそのまま保存
- API quota超過: リトライは次回バッチに持ち越し

---

## 8. コスト試算

月間配信数8回（週2回）と仮定。

| 項目 | 月額コスト |
|------|-----------|
| YouTube Data API v3 | ¥0（無料枠: 10,000 units/日） |
| youtube-transcript-api | ¥0（OSSライブラリ） |
| Gemini 1.5 Flash（月8回×3万字） | ¥0（無料枠: 1500 req/日） |
| Supabase Free tier | ¥0（500MB DB, 50K rows） |
| Vercel Free tier | ¥0（100GB帯域/月） |
| **合計** | **¥0** |

フォールバック使用時の追加コスト:
- Supadata: $0.001/動画（月$0.008）
- Whisper API: $0.006/分 → 90分配信で約$0.54（月$4.32）

---

## 9. 開発フェーズ

| Phase | 内容 | 推定工数 | 前提条件 |
|-------|------|----------|----------|
| **Phase 1** | Supabase プロジェクト作成、DBスキーマ構築、テストデータ投入 | 2-3時間 | Supabaseアカウント |
| **Phase 2** | 字幕取得スクリプト（Python）、Gemini要約パイプライン | 4-6時間 | Google AI Studio APIキー |
| **Phase 3** | 検索UI（React/Next.js）プロトタイプ | 6-8時間 | — |
| **Phase 4** | 管理画面（AI要約の確認・編集） | 3-4時間 | — |
| **Phase 5** | 星評価 + ランキング機能 | 2-3時間 | — |
| **Phase 6** | 自動巡回バッチ構築 | 3-4時間 | YouTube Data API キー |
| **Phase 7** | Vercelデプロイ、URL共有テスト | 1-2時間 | Vercelアカウント |
| **Phase 8** | 実データでの運用テスト、プロンプトチューニング | 2-3時間 | — |

---

## 10. セキュリティ要件

| リスク | 対策 |
|--------|------|
| APIキー露出 | 全APIキーは環境変数管理（`.env.local`、Supabase Vault、Vercel Environment Variables）。コードにハードコーディングしない |
| Supabase RLS | Row Level Security を有効化。`ratings` テーブルは INSERT のみ許可（anonymous）。`streams` / `chapters` は SELECT のみ許可（anonymous） |
| 管理画面アクセス | `/admin` はパスワード保護（Supabase Auth or Vercel Edge Middleware） |
| 全文テキスト漏洩 | `transcript` カラムは Supabase RLS で anonymous ユーザーには SELECT 不可。検索はサーバーサイドの RPC 関数経由 |
| 評価の不正 | user_hash + UNIQUE制約で同一ブラウザからの重複防止。完全な防止は不可能だがファンコミュニティ規模では十分 |

---

## 11. 環境構築に必要なアカウント・キー

実装開始前に以下を準備:

| サービス | 用途 | 取得方法 |
|----------|------|----------|
| **Supabase** | DB + API | https://supabase.com → GitHubログイン → New Project |
| **Google AI Studio** | Gemini API | https://aistudio.google.com → APIキー取得 |
| **Google Cloud Console** | YouTube Data API v3 | https://console.cloud.google.com → API有効化 → APIキー |
| **Vercel** | フロントエンドデプロイ | https://vercel.com → GitHubログイン |
| **（任意）Supadata** | 字幕フォールバック | https://supadata.ai → APIキー取得 |

---

## 12. ファイル構成（想定）

```
ichiro-library/
├── README.md
├── .env.local.example          # 環境変数テンプレート
│
├── packages/
│   └── pipeline/               # データ収集・処理パイプライン（Python）
│       ├── requirements.txt
│       ├── fetch_new_videos.py   # YouTube API で新着動画検知
│       ├── get_transcript.py     # 字幕取得（3段階フォールバック）
│       ├── summarize.py          # Gemini で要約・構造化
│       ├── store.py              # Supabase にデータ登録
│       ├── batch_runner.py       # 上記を統合したバッチ実行スクリプト
│       └── prompts/
│           └── v1.txt            # 要約プロンプト
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # DDL
│
├── src/                        # Next.js フロントエンド
│   ├── app/
│   │   ├── page.tsx              # トップ（検索+一覧+ランキング）
│   │   ├── stream/[id]/page.tsx  # 配信詳細
│   │   └── admin/page.tsx        # 管理画面
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── StreamCard.tsx
│   │   ├── ChapterList.tsx
│   │   ├── StarRating.tsx
│   │   ├── FilterPanel.tsx
│   │   └── RankingSection.tsx
│   └── lib/
│       ├── supabase.ts           # Supabase クライアント初期化
│       └── types.ts              # TypeScript型定義
│
├── package.json
└── vercel.json
```

---

## 付記: 前回の技術的壁（調査結果）

前回のプロトタイプで発生した問題の根本原因:

1. **YouTube公式Captions APIは他人の動画の字幕をダウンロードできない**（OAuth認証で自分の動画のみ）
2. **ライブ配信中の自動字幕は日本語未対応**（英語のみ）

本仕様での解決策:
- 非公式ライブラリ `youtube-transcript-api` を使用（APIキー不要、自動生成字幕にも対応）
- ライブ配信終了後のVODアーカイブに生成される日本語自動字幕を取得対象とする
- 字幕取得失敗時は Supadata → Whisper の3段階フォールバック

---

*End of Specification*
