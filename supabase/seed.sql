-- Seed data for local development / initial testing
-- Run AFTER 001_initial_schema.sql

-- Local seed でも streams.tags を統制語彙に限定する。
INSERT INTO tag_vocabulary (slug, label, category, sort_order, is_active) VALUES
  ('music_production', '音楽制作', 'content', 10, true),
  ('guest', 'ゲスト', 'content', 20, true),
  ('gaming', 'ゲーム', 'content', 30, true)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- ============================================================
-- Sample streams (3 entries)
-- ============================================================
WITH seed_streams (
  video_id, title, stream_date, duration_min,
  view_count, comment_count,
  summary, tags, corner_names, guests,
  transcript,
  youtube_url, thumbnail_url,
  status, ai_model, ai_prompt_ver, is_reviewed
) AS (
VALUES
(
  'test_stream_001',
  '【深夜ラジオ】眠れない夜に　サカナクション山口一郎の独り語り',
  DATE '2026-03-15',
  92,
  18500,
  342,
  '深夜の独り語り配信。最近リリースされたサカナクションの新曲制作の裏話、スタジオでの試行錯誤、歌詞に込めた思いについて語った。後半はリスナーからの質問コーナーとして、音楽理論や作曲プロセスについても丁寧に回答。「音楽は問いを立てること」という山口一郎の哲学が随所に滲む配信となった。',
  ARRAY['music_production'],
  ARRAY['未知との遭遇'],
  ARRAY[]::TEXT[],
  '（サンプル字幕テキスト）こんばんは。今夜も来てくれてありがとうございます。深夜ですね。眠れない人、いますか？僕も眠れないんですよね、最近。で、スタジオに行って音を出してみると、なんか見えてくるものがあって。新曲の話をしようかな。',
  'https://www.youtube.com/watch?v=test_stream_001',
  'https://i.ytimg.com/vi/test_stream_001/maxresdefault.jpg',
  'public',
  'gemini-1.5-flash',
  'v1',
  true
),
(
  'test_stream_002',
  '【深夜対談】草野マサムネ × 山口一郎　音楽と言葉の話',
  DATE '2026-03-22',
  118,
  42300,
  891,
  'スピッツ・草野マサムネをゲストに迎えた深夜対談。お互いの作詞スタイルの違い、言葉の選び方へのこだわり、90年代の音楽シーンの記憶などを語り合った。草野が「詩はウソをつかない」と発言した場面がハイライトとなり、コメント欄でも大きな反響を呼んだ。終盤は二人でプレイリストを共有し合うセッションも。',
  ARRAY['guest', 'music_production'],
  ARRAY['深夜対談'],
  ARRAY['草野マサムネ'],
  '（サンプル字幕テキスト）今夜はですね、スペシャルゲストを迎えております。スピッツの草野マサムネさんです。草野さん、久しぶりですね。そうですね、久しぶり。最後に会ったのいつでしたっけ。あのフェスかな、去年の。そうそう。今日は言葉と音楽の話をしたくて呼びました。',
  'https://www.youtube.com/watch?v=test_stream_002',
  'https://i.ytimg.com/vi/test_stream_002/maxresdefault.jpg',
  'public',
  'gemini-1.5-flash',
  'v1',
  true
),
(
  'test_stream_003',
  '【未知との遭遇】最近ハマってる音楽10選　縛りなし全ジャンル',
  DATE '2026-04-05',
  75,
  9800,
  215,
  '「未知との遭遇」コーナー企画として、山口一郎が最近個人的に聴きまくっている楽曲10選を紹介。ジャンルはポストクラシカル、ケルト音楽、シティポップのリイシュー盤まで幅広く、それぞれ選んだ理由や音楽的な着眼点を丁寧に解説した。「この曲の低音の使い方が衝撃で」など具体的な音の話が多く、リスナーから「授業みたい」とコメントが相次いだ。',
  ARRAY['gaming', 'music_production'],
  ARRAY['未知との遭遇'],
  ARRAY[]::TEXT[],
  '（サンプル字幕テキスト）はい、今夜は未知との遭遇回です。最近ね、めちゃくちゃ聴いてる曲があって。ジャンルばらばらなんですけど、10曲に絞ってきました。まず1曲目なんですけど、これはポストクラシカルというか、ピアノと弦楽器の曲で。',
  'https://www.youtube.com/watch?v=test_stream_003',
  'https://i.ytimg.com/vi/test_stream_003/maxresdefault.jpg',
  'public',
  'gemini-1.5-flash',
  'v1',
  false
)
),
invalid_tags AS (
  SELECT DISTINCT candidate.tag
  FROM seed_streams seed_stream
  CROSS JOIN LATERAL unnest(coalesce(seed_stream.tags, '{}'::text[])) AS candidate(tag)
  LEFT JOIN tag_vocabulary vocabulary
    ON vocabulary.slug = candidate.tag
   AND vocabulary.is_active = true
  WHERE vocabulary.slug IS NULL
),
tag_validation AS (
  -- The reference to valid below makes an invalid tag abort this INSERT before
  -- any stream row can be written.  Keep this as one statement: Supabase CLI
  -- prepares seed statements independently, so TEMP tables cannot cross them.
  SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM invalid_tags) THEN 0 ELSE 1 END AS valid
)

INSERT INTO streams (
  video_id, title, stream_date, duration_min,
  view_count, comment_count,
  summary, tags, corner_names, guests,
  transcript,
  youtube_url, thumbnail_url,
  status, ai_model, ai_prompt_ver, is_reviewed
)
SELECT
  video_id, title, stream_date, duration_min,
  view_count, comment_count,
  summary, tags, corner_names, guests,
  transcript,
  youtube_url, thumbnail_url,
  status, ai_model, ai_prompt_ver, is_reviewed
FROM seed_streams
CROSS JOIN tag_validation
WHERE tag_validation.valid = 1;

-- ============================================================
-- Sample chapters
-- ============================================================
WITH s1 AS (SELECT id FROM streams WHERE video_id = 'test_stream_001'),
     s2 AS (SELECT id FROM streams WHERE video_id = 'test_stream_002'),
     s3 AS (SELECT id FROM streams WHERE video_id = 'test_stream_003')
INSERT INTO chapters (stream_id, start_sec, end_sec, title, summary, transcript_segment, sort_order)
SELECT id, 0,    420,  'オープニング・近況報告',       '眠れない夜の独り語りとして始まり、最近のスタジオ作業の状況を報告。', '（サンプル）こんばんは。眠れない夜ですね。スタジオで音を出してきました。', 1 FROM s1
UNION ALL
SELECT id, 420,  2800, '新曲制作の裏話',               'サカナクション新曲の制作プロセス、コード進行のこだわりについて詳しく語る。', '（サンプル）新曲の話をしようかな。コード進行がちょっと変わってて。', 2 FROM s1
UNION ALL
SELECT id, 2800, 4200, '歌詞に込めた意味',             '言葉の選び方と、「問いを立てること」が音楽の本質だという持論を展開。', '（サンプル）歌詞ってね、答えを書かないようにしてるんですよ。問いを立てること。', 3 FROM s1
UNION ALL
SELECT id, 4200, 5520, 'リスナーQ&A',                  '音楽理論・作曲プロセスに関するリスナー質問に丁寧に回答。',             '（サンプル）コメントから質問来てますね。音楽理論は独学ですか？という。', 4 FROM s1
UNION ALL
SELECT id, 0,    900,  'オープニング・草野さん登場',    '久しぶりの再会を語り合い、今夜の対談テーマを設定。',                  '（サンプル）今夜はスペシャルゲスト、草野マサムネさんです。', 1 FROM s2
UNION ALL
SELECT id, 900,  3000, 'お互いの作詞スタイル',         '二人の作詞アプローチの違い、言葉選びへのこだわりを比較。',             '（サンプル）草野さんの詞は情景描写がすごくて。僕は問いかけが多いんですよね。', 2 FROM s2
UNION ALL
SELECT id, 3000, 5400, '90年代の音楽シーンの記憶',    '両者が影響を受けたアーティスト、時代の空気について振り返る。',          '（サンプル）90年代って、日本語ロックが爆発した時代じゃないですか。', 3 FROM s2
UNION ALL
SELECT id, 5400, 7080, 'プレイリスト交換セッション',   '互いのお気に入り曲をその場で紹介し合い、感想を語り合う。',             '（サンプル）じゃあ僕のプレイリストから一曲かけますね。', 4 FROM s2
UNION ALL
SELECT id, 0,    600,  'オープニング・企画説明',        '「未知との遭遇」コーナーの趣旨説明と今夜の10曲リスト公開。',           '（サンプル）今夜は未知との遭遇回です。10曲に絞ってきました。', 1 FROM s3
UNION ALL
SELECT id, 600,  2400, 'ポストクラシカル〜ケルト音楽', 'ピアノと弦楽器の曲を中心に、低音の使い方について解説。',               '（サンプル）1曲目はポストクラシカル。低音の使い方が衝撃で。', 2 FROM s3
UNION ALL
SELECT id, 2400, 4500, 'シティポップ再発見',           'リイシューされたシティポップの名盤について、音の質感を語る。',          '（サンプル）シティポップのリイシュー、最近すごく良くて。', 3 FROM s3;

-- ============================================================
-- Sample ratings
-- ============================================================
WITH s1 AS (SELECT id FROM streams WHERE video_id = 'test_stream_001'),
     s2 AS (SELECT id FROM streams WHERE video_id = 'test_stream_002')
INSERT INTO ratings (stream_id, user_hash, rating)
SELECT id, 'hash_user_a', 5 FROM s1
UNION ALL
SELECT id, 'hash_user_b', 4 FROM s1
UNION ALL
SELECT id, 'hash_user_c', 5 FROM s1
UNION ALL
SELECT id, 'hash_user_a', 5 FROM s2
UNION ALL
SELECT id, 'hash_user_b', 5 FROM s2
UNION ALL
SELECT id, 'hash_user_c', 4 FROM s2
UNION ALL
SELECT id, 'hash_user_d', 5 FROM s2;
