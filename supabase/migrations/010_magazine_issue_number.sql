ALTER TABLE magazines ADD COLUMN IF NOT EXISTS issue_number INTEGER UNIQUE;

-- 既存マガジンへの号数バックフィル（week_label昇順で採番）
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY week_label ASC) AS rn
  FROM magazines
)
UPDATE magazines SET issue_number = numbered.rn
FROM numbered WHERE magazines.id = numbered.id;
