-- songs master data for Gemini prompt injection
CREATE TABLE songs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  album       TEXT,
  released_at DATE,
  disc_no     INTEGER,
  track_no    INTEGER,
  notes       TEXT
);

ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON songs TO anon, authenticated;
CREATE POLICY "songs_read" ON songs FOR SELECT USING (true);
-- INSERT/UPDATE/DELETE は service_role のみ（RLS bypass）。anon/authenticated への GRANT なし

INSERT INTO songs (title, album, released_at, disc_no, track_no, notes)
VALUES
  -- GO TO THE FUTURE (2007)
  ('三日月サンセット',           'GO TO THE FUTURE', '2007-01-01', 1,  1, NULL),
  ('インナーワールド',           'GO TO THE FUTURE', '2007-01-01', 1,  2, NULL),
  ('あめふら',                   'GO TO THE FUTURE', '2007-01-01', 1,  3, NULL),
  ('GO TO THE FUTURE',           'GO TO THE FUTURE', '2007-01-01', 1,  4, NULL),
  ('フクロウ',                   'GO TO THE FUTURE', '2007-01-01', 1,  5, NULL),
  ('開花',                       'GO TO THE FUTURE', '2007-01-01', 1,  6, NULL),
  ('白波トップウォーター',       'GO TO THE FUTURE', '2007-01-01', 1,  7, NULL),
  ('夜の東側',                   'GO TO THE FUTURE', '2007-01-01', 1,  8, NULL),

  -- NIGHT FISHING (2008)
  ('ワード',                     'NIGHT FISHING', '2008-01-01', 1,  1, NULL),
  ('サンプル',                   'NIGHT FISHING', '2008-01-01', 1,  2, NULL),
  ('ナイトフィッシングイズグッド','NIGHT FISHING', '2008-01-01', 1,  3, NULL),
  ('雨は気まぐれ',               'NIGHT FISHING', '2008-01-01', 1,  4, NULL),
  ('マレーシア32',               'NIGHT FISHING', '2008-01-01', 1,  5, NULL),
  ('うねり',                     'NIGHT FISHING', '2008-01-01', 1,  6, NULL),
  ('ティーンエイジ',             'NIGHT FISHING', '2008-01-01', 1,  7, NULL),
  ('哀愁トレイン',               'NIGHT FISHING', '2008-01-01', 1,  8, NULL),
  ('新しい世界',                 'NIGHT FISHING', '2008-01-01', 1,  9, NULL),
  ('アムスフィッシュ',           'NIGHT FISHING', '2008-01-01', 1, 10, NULL),

  -- シンシロ (2009)
  ('Ame(B)',                     'シンシロ', '2009-01-01', 1,  1, NULL),
  ('ライトダンス',               'シンシロ', '2009-01-01', 1,  2, NULL),
  ('セントレイ',                 'シンシロ', '2009-01-01', 1,  3, NULL),
  ('ネイティブダンサー',         'シンシロ', '2009-01-01', 1,  4, NULL),
  ('minnanouta',                 'シンシロ', '2009-01-01', 1,  5, NULL),
  ('雑踏',                       'シンシロ', '2009-01-01', 1,  6, NULL),
  ('黄色い車',                   'シンシロ', '2009-01-01', 1,  7, NULL),
  ('enough',                     'シンシロ', '2009-01-01', 1,  8, NULL),
  ('涙ディライト',               'シンシロ', '2009-01-01', 1,  9, NULL),
  ('アドベンチャー',             'シンシロ', '2009-01-01', 1, 10, NULL),
  ('human',                      'シンシロ', '2009-01-01', 1, 11, NULL),

  -- kikUUiki (2010)
  ('intro = 汽空域',             'kikUUiki', '2010-01-01', 1,  1, NULL),
  ('潮',                         'kikUUiki', '2010-01-01', 1,  2, NULL),
  ('YES NO',                     'kikUUiki', '2010-01-01', 1,  3, NULL),
  ('アルクアラウンド',           'kikUUiki', '2010-01-01', 1,  4, NULL),
  ('Klee',                       'kikUUiki', '2010-01-01', 1,  5, NULL),
  ('21.1',                       'kikUUiki', '2010-01-01', 1,  6, NULL),
  ('アンダー',                   'kikUUiki', '2010-01-01', 1,  7, NULL),
  ('シーラカンスと僕',           'kikUUiki', '2010-01-01', 1,  8, NULL),
  ('明日から',                   'kikUUiki', '2010-01-01', 1,  9, NULL),
  ('表参道26時',                 'kikUUiki', '2010-01-01', 1, 10, NULL),
  ('壁',                         'kikUUiki', '2010-01-01', 1, 11, NULL),
  ('目が明く藍色',               'kikUUiki', '2010-01-01', 1, 12, NULL),
  ('Paradise of Sunny',          'kikUUiki', '2010-01-01', 1, 13, NULL),

  -- DocumentaLy (2011)
  ('RL',                         'DocumentaLy', '2011-01-01', 1,  1, NULL),
  ('アイデンティティ',           'DocumentaLy', '2011-01-01', 1,  2, NULL),
  ('モノクロトウキョー',         'DocumentaLy', '2011-01-01', 1,  3, NULL),
  ('ルーキー',                   'DocumentaLy', '2011-01-01', 1,  4, NULL),
  ('アンタレスと針',             'DocumentaLy', '2011-01-01', 1,  5, NULL),
  ('仮面の街',                   'DocumentaLy', '2011-01-01', 1,  6, NULL),
  ('流線',                       'DocumentaLy', '2011-01-01', 1,  7, NULL),
  ('エンドレス',                 'DocumentaLy', '2011-01-01', 1,  8, NULL),
  ('DocumentaRy',                'DocumentaLy', '2011-01-01', 1,  9, NULL),
  ('『バッハの旋律を夜に聴いたせいです。』', 'DocumentaLy', '2011-01-01', 1, 10, NULL),
  ('years',                      'DocumentaLy', '2011-01-01', 1, 11, NULL),
  ('ドキュメント',               'DocumentaLy', '2011-01-01', 1, 12, NULL),

  -- sakanaction (2013)
  ('intro',                      'sakanaction', '2013-01-01', 1,  1, NULL),
  ('INORI',                      'sakanaction', '2013-01-01', 1,  2, NULL),
  ('ミュージック',               'sakanaction', '2013-01-01', 1,  3, NULL),
  ('夜の踊り子',                 'sakanaction', '2013-01-01', 1,  4, NULL),
  ('なんてったって春',           'sakanaction', '2013-01-01', 1,  5, NULL),
  ('アルデバラン',               'sakanaction', '2013-01-01', 1,  6, NULL),
  ('M',                          'sakanaction', '2013-01-01', 1,  7, NULL),
  ('Aoi',                        'sakanaction', '2013-01-01', 1,  8, NULL),
  ('ボイル',                     'sakanaction', '2013-01-01', 1,  9, NULL),
  ('映画',                       'sakanaction', '2013-01-01', 1, 10, NULL),
  ('僕と花',                     'sakanaction', '2013-01-01', 1, 11, NULL),
  ('mellow',                     'sakanaction', '2013-01-01', 1, 12, NULL),
  ('ストラクチャー',             'sakanaction', '2013-01-01', 1, 13, NULL),
  ('朝の歌',                     'sakanaction', '2013-01-01', 1, 14, NULL),

  -- 834.194 (2019) DISC1
  ('忘れられないの',             '834.194', '2019-01-01', 1,  1, NULL),
  ('マッチとピーナッツ',         '834.194', '2019-01-01', 1,  2, NULL),
  ('陽炎',                       '834.194', '2019-01-01', 1,  3, NULL),
  ('多分、風。',                 '834.194', '2019-01-01', 1,  4, NULL),
  ('新宝島',                     '834.194', '2019-01-01', 1,  5, NULL),
  ('モス',                       '834.194', '2019-01-01', 1,  6, NULL),
  ('「聴きたかったダンスミュージック、リキッドルームに」', '834.194', '2019-01-01', 1, 7, NULL),
  ('ユリイカ (Shotaro Aoyama Remix)', '834.194', '2019-01-01', 1, 8, NULL),
  ('セプテンバー -東京 version-','834.194', '2019-01-01', 1,  9, NULL),

  -- 834.194 (2019) DISC2
  ('グッドバイ',                 '834.194', '2019-01-01', 2,  1, NULL),
  ('蓮の花',                     '834.194', '2019-01-01', 2,  2, NULL),
  ('ユリイカ',                   '834.194', '2019-01-01', 2,  3, NULL),
  ('ナイロンの糸',               '834.194', '2019-01-01', 2,  4, NULL),
  ('茶柱',                       '834.194', '2019-01-01', 2,  5, NULL),
  ('ワンダーランド',             '834.194', '2019-01-01', 2,  6, NULL),
  ('さよならはエモーション',     '834.194', '2019-01-01', 2,  7, NULL),
  ('834.194',                    '834.194', '2019-01-01', 2,  8, NULL),
  ('セプテンバー -札幌 version-','834.194', '2019-01-01', 2,  9, NULL),

  -- アダプト (2022) DISC1
  ('塔',                         'アダプト', '2022-01-01', 1,  1, NULL),
  ('キャラバン',                 'アダプト', '2022-01-01', 1,  2, NULL),
  ('月の椀',                     'アダプト', '2022-01-01', 1,  3, NULL),
  ('プラトー',                   'アダプト', '2022-01-01', 1,  4, NULL),
  ('ショック!',                  'アダプト', '2022-01-01', 1,  5, NULL),
  ('エウリュノメー',             'アダプト', '2022-01-01', 1,  6, NULL),
  ('シャンディガフ',             'アダプト', '2022-01-01', 1,  7, NULL),
  ('フレンドリー',               'アダプト', '2022-01-01', 1,  8, NULL),
  ('DocumentaRy of ADAPT',       'アダプト', '2022-01-01', 1,  9, NULL);

-- Verify row count after applying this migration:
-- SELECT COUNT(*) FROM songs; -- expected: 95
