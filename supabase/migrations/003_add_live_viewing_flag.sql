-- has_live_viewing（ライブ映像鑑賞の有無）
ALTER TABLE streams ADD COLUMN IF NOT EXISTS has_live_viewing BOOLEAN;
