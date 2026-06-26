-- シングル配信曲の追加（DB直接INSERT済みのため冪等に処理）
INSERT INTO songs (title, album, released_at, disc_no, track_no, notes)
SELECT '怪獣', 'シングル', '2025-02-20', 1, 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM songs WHERE title = '怪獣' AND album = 'シングル');

INSERT INTO songs (title, album, released_at, disc_no, track_no, notes)
SELECT 'いらない', 'シングル', '2026-02-11', 1, 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM songs WHERE title = 'いらない' AND album = 'シングル');
