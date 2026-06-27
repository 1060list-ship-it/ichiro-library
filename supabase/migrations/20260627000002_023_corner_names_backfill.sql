-- 023: corner_names → tags backfill
-- corner_names の内容を tags に統合し重複を除去する。
-- corner_names カラムは互換のために残す（dual-write フェーズ）。

WITH expanded AS (
  SELECT
    s.id,
    value,
    min(ord) AS first_ord
  FROM streams s
  CROSS JOIN LATERAL unnest(
    coalesce(s.tags, '{}'::text[]) || coalesce(s.corner_names, '{}'::text[])
  ) WITH ORDINALITY AS merged(value, ord)
  WHERE btrim(value) <> ''
  GROUP BY s.id, value
)
UPDATE streams s
SET tags = ARRAY(
  SELECT e.value
  FROM expanded e
  WHERE e.id = s.id
  ORDER BY e.first_ord
)
WHERE cardinality(coalesce(s.corner_names, '{}'::text[])) > 0;
