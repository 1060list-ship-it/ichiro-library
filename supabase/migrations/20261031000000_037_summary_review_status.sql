-- DRAFT / 未適用。設計修正のみ。実装・SQL適用・本番反映は別承認。
-- 2026-11-01 改訂: 案A（履歴不明行は保存可・校閲対象外・一幖承認）を反映。history_unknown例外は廃止。
-- 2026-11-03 改訂: M-5（再保存時の旧active run終端化）と stale の attempt任意化（CHECK緩和）を反映。
-- 2026-11-04 改訂: M-2（INSERT正規入力の一意定義・矛盾INSERTの例外化）を反映。
-- 2026-11-11 改訂: M-2（INSERT時のstatus×base整合規則・矛盾INSERT例外化）を反映。
-- 2026-11-11 改訂2: M-2（UPDATE時のstatus×base不一致拒否・矛盾UPDATE例外化）を反映。
-- 2026-11-11 改訂3: M-2（update_summary_review_state RPC・実行テスト節）を反映。
-- 正式結果は recheck（2026-11-03）preflight/initial blocked: M-2 open（M-1/M-3/M-4/M-5 resolved・N-1 open）。
-- 旧r2 abandoned / r3起動拒否は正式結果ではない。
-- 依存順: streams列→backfill→trigger→run/log→保存/claim/commit RPC→権限。
-- 単回migration想定。既に一部適用された環境への再実行は未設計。
BEGIN;
LOCK TABLE public.streams IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.streams
  ADD COLUMN summary_review_status text NOT NULL DEFAULT 'legacy_unreviewed',
  ADD COLUMN summary_review_base_status text NOT NULL DEFAULT 'legacy_unreviewed',
  ADD COLUMN summary_review_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN summary_success_seen boolean DEFAULT false;

-- 空の旧本文は過去成功の有無が不明。falseと推測しない。
-- 案A（2026-11-01 一幖承認）: NULL行は保存可・校閲対象外（base=legacy_unreviewedのまま人手確認）。
-- NULLはNULLのまま維持（triggerの単調制約でNULL→NOT NULL遷移は拒否）。履歴監査による確定は将来の別作業。
UPDATE public.streams SET
  is_reviewed = coalesce(is_reviewed, false),
  summary_review_status = CASE WHEN is_reviewed IS TRUE THEN 'confirmed' ELSE 'legacy_unreviewed' END,
  summary_success_seen = CASE WHEN summary ~ '[^[:space:]]' THEN true ELSE NULL END;
ALTER TABLE public.streams ALTER COLUMN is_reviewed SET NOT NULL;
ALTER TABLE public.streams
  ADD CONSTRAINT streams_review_base_check CHECK (summary_review_base_status IN
    ('legacy_unreviewed','pending','reviewed_no_change','auto_fixed','needs_review','review_failed')),
  ADD CONSTRAINT streams_review_status_check CHECK (summary_review_status = 'confirmed'
    OR summary_review_status = summary_review_base_status),
  ADD CONSTRAINT streams_is_reviewed_confirmed_iff CHECK
    ((is_reviewed IS TRUE) = (summary_review_status = 'confirmed')),
  ADD CONSTRAINT streams_review_version_check CHECK (summary_review_version >= 0);

-- OLD/NEWのみ参照。finding 0件でもbaseを保持。関連表への前方参照なし。
CREATE OR REPLACE FUNCTION public.sync_summary_review_confirmed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  bool_changed boolean;
  status_changed boolean;
BEGIN
  NEW.is_reviewed := coalesce(NEW.is_reviewed, false);
  IF TG_OP = 'INSERT' THEN
    -- M-2（2026-11-04）: INSERTの正規入力は一意（true⇔confirmed ／ false＋非confirmed）。
    -- NULLは関数先頭でfalseへ正規化済み。矛盾INSERTはUPDATE分岐と対称に例外で拒否し、黙って正規化しない。
    IF (NEW.is_reviewed AND NEW.summary_review_status <> 'confirmed')
       OR (NOT NEW.is_reviewed AND NEW.summary_review_status = 'confirmed') THEN
      RAISE EXCEPTION 'summary_review: contradictory_confirmation_insert';
    END IF;
    -- M-2（2026-11-11）: 最終正規化はbaseを公開ラベルへ写すため、不一致はstatus入力を捨てるbase正本の黙示同期になる。
    -- 非confirmedの一致ペアを要求し、UPDATE分岐の矛盾拒否と対称化する。
    IF NOT NEW.is_reviewed AND NEW.summary_review_status IS DISTINCT FROM NEW.summary_review_base_status THEN
      RAISE EXCEPTION 'summary_review: contradictory_status_base_insert';
    END IF;
    NEW.summary_review_version := 0;
  ELSE
    IF (OLD.summary_success_seen IS FALSE AND NEW.summary_success_seen IS NULL)
       OR (OLD.summary_success_seen IS TRUE AND NEW.summary_success_seen IS DISTINCT FROM true)
       OR (OLD.summary_success_seen IS NULL AND NEW.summary_success_seen IS NOT NULL) THEN
      RAISE EXCEPTION 'summary_review: non_monotonic_or_unknown_history';
    END IF;
    bool_changed := NEW.is_reviewed IS DISTINCT FROM OLD.is_reviewed;
    status_changed := NEW.summary_review_status IS DISTINCT FROM OLD.summary_review_status;
    IF bool_changed AND status_changed AND
       (NEW.is_reviewed <> (NEW.summary_review_status = 'confirmed')) THEN
      RAISE EXCEPTION 'summary_review: contradictory_confirmation';
    END IF;
    IF NOT bool_changed AND status_changed THEN
      NEW.is_reviewed := NEW.summary_review_status = 'confirmed';
    END IF;
    -- M-2（2026-11-11 改訂2）: UPDATEでstatusとbaseの両方を明示変更した結果が不一致になる入力は、
    -- 黙示同期で片方を捨てる代わりに例外で拒否する（INSERT分岐の contradictory_status_base_insert と対称）。
    -- statusのみ／baseのみの単独変更と、confirmedへの遷移（base=確認解除時の復元先の保存）は従来どおり許す。
    IF NEW.summary_review_status <> 'confirmed'
       AND NEW.summary_review_status IS DISTINCT FROM OLD.summary_review_status
       AND NEW.summary_review_base_status IS DISTINCT FROM OLD.summary_review_base_status
       AND NEW.summary_review_status IS DISTINCT FROM NEW.summary_review_base_status THEN
      RAISE EXCEPTION 'summary_review: contradictory_status_base_update';
    END IF;
    IF status_changed AND NEW.summary_review_status <> 'confirmed' THEN
      NEW.summary_review_base_status := NEW.summary_review_status;
    ELSIF NOT status_changed
      AND NEW.summary_review_base_status = OLD.summary_review_base_status
      AND (NEW.summary IS DISTINCT FROM OLD.summary OR NEW.transcript IS DISTINCT FROM OLD.transcript)
      AND OLD.summary_review_base_status <> 'legacy_unreviewed' THEN
      NEW.summary_review_base_status := 'needs_review';
    END IF;
    NEW.summary_review_version := OLD.summary_review_version + CASE WHEN
      NEW.summary IS DISTINCT FROM OLD.summary OR NEW.transcript IS DISTINCT FROM OLD.transcript
      OR NEW.is_reviewed IS DISTINCT FROM OLD.is_reviewed
      OR NEW.summary_success_seen IS DISTINCT FROM OLD.summary_success_seen THEN 1 ELSE 0 END;
  END IF;
  NEW.summary_review_status := CASE WHEN NEW.is_reviewed THEN 'confirmed'
    ELSE NEW.summary_review_base_status END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_summary_review_confirmed BEFORE INSERT OR UPDATE ON public.streams
FOR EACH ROW EXECUTE FUNCTION public.sync_summary_review_confirmed();

CREATE TABLE public.summary_review_runs (
  review_run_id uuid PRIMARY KEY,
  stream_id uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  input_version bigint NOT NULL CHECK (input_version >= 0),
  input_summary text NOT NULL CHECK (input_summary ~ '[^[:space:]]'),
  input_transcript text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','stale')),
  attempt_id uuid,
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (stream_id, input_version),
  UNIQUE (review_run_id, stream_id),
  CHECK ((state = 'pending' AND attempt_id IS NULL AND result_payload IS NULL AND finished_at IS NULL)
    OR (state = 'running' AND attempt_id IS NOT NULL AND result_payload IS NULL AND finished_at IS NULL)
    OR (state IN ('succeeded','failed') AND attempt_id IS NOT NULL
      AND result_payload IS NOT NULL AND finished_at IS NOT NULL)
    -- M-5（2026-11-03）: stale は未claim（attempt NULL）のまま再保存で無効化されたrunを含む。
    OR (state = 'stale' AND result_payload IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE TABLE public.summary_review_log (
  review_run_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  finding_no integer NOT NULL CHECK (finding_no > 0),
  finding_type text NOT NULL CHECK (btrim(finding_type) <> ''),
  rule_id text NOT NULL CHECK (btrim(rule_id) <> ''),
  field text NOT NULL CHECK (field = 'summary'),
  excerpt text,
  before_text text NOT NULL,
  after_text text NOT NULL,
  evidence text NOT NULL CHECK (btrim(evidence) <> ''),
  confidence text NOT NULL CHECK (confidence IN ('high','low')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_run_id, finding_no),
  FOREIGN KEY (review_run_id, stream_id)
    REFERENCES public.summary_review_runs(review_run_id, stream_id) ON DELETE CASCADE,
  CHECK (confidence <> 'low' OR before_text = after_text)
);
CREATE INDEX idx_summary_review_log_stream ON public.summary_review_log(stream_id);

-- 生成側がsummaryを直接upsertしないことが統合前提。タグ/章は既存ロックを維持。
CREATE OR REPLACE FUNCTION public.save_generated_summary(
  p_stream_id uuid, p_expected_version bigint, p_summary_text text, p_review_run_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  s public.streams%ROWTYPE;
  r public.summary_review_runs%ROWTYPE;
  first_success boolean := false;
  run_id uuid;
BEGIN
  IF p_stream_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_review_run_id IS NULL THEN RAISE EXCEPTION 'summary_review: invalid_save_input'; END IF;
  SELECT * INTO s FROM public.streams WHERE id = p_stream_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'summary_review: stream_not_found'; END IF;
  -- 常にstreams→run。既存runの再送は本文や終端状態を再適用しない。
  SELECT * INTO r FROM public.summary_review_runs WHERE review_run_id = p_review_run_id FOR UPDATE;
  IF FOUND THEN
    IF r.stream_id <> p_stream_id OR r.input_summary IS DISTINCT FROM p_summary_text
      OR r.input_version <> p_expected_version + 1 THEN
      RAISE EXCEPTION 'summary_review: run_id_reuse';
    END IF;
    RETURN jsonb_build_object('stream_id',s.id,'is_review_locked',s.is_reviewed,
      'was_first_summary_success',false,'review_run_id',r.review_run_id,'version',s.summary_review_version);
  END IF;
  IF s.is_reviewed THEN
    RETURN jsonb_build_object('stream_id',s.id,'is_review_locked',true,
      'was_first_summary_success',false,'review_run_id',NULL,'version',s.summary_review_version);
  END IF;
  IF s.summary_review_version <> p_expected_version THEN
    RAISE EXCEPTION 'summary_review: version_conflict';
  END IF;
  IF p_summary_text IS NOT NULL AND p_summary_text ~ '[^[:space:]]' THEN
    -- 案A（2026-11-01 一幖承認）: 履歴不明(NULL)でも本文保存を拒否しない。
    -- NULL行は校閲runを作らず base=legacy_unreviewed のまま人手確認へ。NULLはNULLのまま維持。
    first_success := (s.summary_success_seen IS FALSE);
    -- M-5（2026-11-03）: 非first再保存は既存のactive run（pending/running/failed）を
    -- 本文保存と同一トランザクションで stale へ終端化する（孤児run・後続commitの部分更新を防ぐ）。
    -- 成功歴false行にactive runは存在し得ない（runはfirst保存でしか作られない）ためfirst分岐は対象外。
    IF NOT first_success THEN
      UPDATE public.summary_review_runs
        SET state='stale',
            result_payload=jsonb_build_object('stale_reason','superseded_by_resave',
                                              'stream_version',s.summary_review_version),
            finished_at=now()
        WHERE stream_id=s.id AND state IN ('pending','running','failed');
    END IF;
    UPDATE public.streams SET summary = p_summary_text,
      summary_success_seen = CASE WHEN s.summary_success_seen IS NULL THEN NULL ELSE true END,
      summary_review_base_status = CASE WHEN first_success THEN 'pending' ELSE 'legacy_unreviewed' END,
      summary_review_status = CASE WHEN first_success THEN 'pending' ELSE 'legacy_unreviewed' END
      WHERE id = s.id RETURNING * INTO s;
    IF first_success THEN
      run_id := p_review_run_id;
      INSERT INTO public.summary_review_runs(review_run_id,stream_id,input_version,input_summary,input_transcript)
        VALUES (run_id,s.id,s.summary_review_version,s.summary,s.transcript);
    END IF;
  END IF;
  -- NULL/空/失敗: 既存本文を消さず、マーカー/runは変更しない。
  RETURN jsonb_build_object('stream_id',s.id,'is_review_locked',false,
    'was_first_summary_success',first_success,'review_run_id',run_id,'version',s.summary_review_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_summary_review_run(
  p_review_run_id uuid, p_stream_id uuid, p_attempt_id uuid, p_previous_attempt_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r public.summary_review_runs%ROWTYPE;
BEGIN
  IF p_review_run_id IS NULL OR p_stream_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'summary_review: invalid_claim_input'; END IF;
  PERFORM 1 FROM public.streams WHERE id = p_stream_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'summary_review: stream_not_found'; END IF;
  SELECT * INTO r FROM public.summary_review_runs WHERE review_run_id = p_review_run_id FOR UPDATE;
  IF NOT FOUND OR r.stream_id <> p_stream_id THEN RAISE EXCEPTION 'summary_review: run_stream_mismatch'; END IF;
  IF r.attempt_id = p_attempt_id OR r.state IN ('succeeded','stale') THEN
    RETURN jsonb_build_object('state',r.state,'claimed',false,'attempt_id',r.attempt_id);
  END IF;
  IF ((r.state = 'pending' AND p_previous_attempt_id IS NULL)
    OR (r.state IN ('running','failed') AND p_previous_attempt_id = r.attempt_id)) IS NOT TRUE THEN
    RETURN jsonb_build_object('state',r.state,'claimed',false,'attempt_id',r.attempt_id);
  END IF;
  -- 復旧CASは元worker停止確認後だけ。期限だけで自動奪取しない。
  UPDATE public.summary_review_runs SET state='running',attempt_id=p_attempt_id,
    result_payload=NULL,finished_at=NULL WHERE review_run_id=p_review_run_id;
  RETURN jsonb_build_object('state','running','claimed',true,'attempt_id',p_attempt_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_summary_review_run(
  p_review_run_id uuid, p_stream_id uuid, p_attempt_id uuid,
  p_findings jsonb, p_summary_text text, p_new_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  s public.streams%ROWTYPE;
  r public.summary_review_runs%ROWTYPE;
  payload jsonb;
  f jsonb;
  k text;
  n integer := 0;
  has_low boolean := false;
  has_change boolean := false;
  final_state text;
BEGIN
  IF p_review_run_id IS NULL OR p_stream_id IS NULL OR p_attempt_id IS NULL
    OR p_findings IS NULL OR jsonb_typeof(p_findings) <> 'array'
    OR p_summary_text IS NULL OR NOT (p_summary_text ~ '[^[:space:]]')
    OR p_new_status IS NULL OR p_new_status NOT IN
      ('reviewed_no_change','auto_fixed','needs_review','review_failed') THEN
    RAISE EXCEPTION 'summary_review: invalid_commit_input';
  END IF;
  SELECT * INTO s FROM public.streams WHERE id=p_stream_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'summary_review: stream_not_found'; END IF;
  SELECT * INTO r FROM public.summary_review_runs WHERE review_run_id=p_review_run_id FOR UPDATE;
  IF NOT FOUND OR r.stream_id <> p_stream_id THEN RAISE EXCEPTION 'summary_review: run_stream_mismatch'; END IF;
  payload := jsonb_build_object('summary',p_summary_text,'status',p_new_status,'findings',p_findings);
  IF r.attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'summary_review: obsolete_attempt'; END IF;
  IF r.state IN ('succeeded','failed','stale') THEN
    IF r.result_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'summary_review: terminal_payload_changed'; END IF;
    RETURN jsonb_build_object('state',r.state,'replayed',true);
  END IF;
  IF r.state <> 'running' THEN RAISE EXCEPTION 'summary_review: not_claimed'; END IF;
  IF s.is_reviewed OR s.summary_review_version <> r.input_version
    OR s.summary IS DISTINCT FROM r.input_summary OR s.transcript IS DISTINCT FROM r.input_transcript THEN
    UPDATE public.summary_review_runs SET state='stale',result_payload=payload,finished_at=now()
      WHERE review_run_id=p_review_run_id;
    RETURN jsonb_build_object('state','stale','replayed',false);
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    IF jsonb_typeof(f) <> 'object' THEN RAISE EXCEPTION 'summary_review: invalid_finding'; END IF;
    FOREACH k IN ARRAY ARRAY['finding_type','rule_id','field','before_text','after_text','evidence','confidence'] LOOP
      IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'summary_review: missing_or_nonstring_finding_field'; END IF;
    END LOOP;
    IF btrim(f->>'finding_type') = '' OR btrim(f->>'rule_id') = '' OR btrim(f->>'evidence') = ''
      OR f->>'field' <> 'summary' OR f->>'confidence' NOT IN ('high','low') THEN
      RAISE EXCEPTION 'summary_review: invalid_finding_contract';
    END IF;
    IF f->>'confidence' = 'low' THEN
      has_low := true;
      IF f->>'before_text' <> f->>'after_text' THEN RAISE EXCEPTION 'summary_review: low_change'; END IF;
    ELSIF f->>'before_text' <> f->>'after_text' THEN
      has_change := true;
    END IF;
  END LOOP;
  IF p_new_status IN ('reviewed_no_change','review_failed') AND
    (jsonb_array_length(p_findings) <> 0 OR p_summary_text IS DISTINCT FROM r.input_summary) THEN
    RAISE EXCEPTION 'summary_review: unchanged_result_required';
  END IF;
  IF (p_new_status = 'auto_fixed' AND (NOT has_change OR has_low OR p_summary_text = r.input_summary))
    OR (p_new_status = 'needs_review' AND NOT has_low)
    OR (p_summary_text IS DISTINCT FROM r.input_summary AND NOT has_change) THEN
    RAISE EXCEPTION 'summary_review: result_status_mismatch';
  END IF;
  -- §3の機械的根拠検証は呼出側の責務。SQLは真実性を推定しない。
  -- ログに入れる本文変更と最終本文の一致は下記の順次置換で検査する。
  DECLARE
    reconstructed text := r.input_summary;
  BEGIN
    FOR f IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
      IF f->>'confidence' = 'high' AND f->>'before_text' <> f->>'after_text' THEN
        IF f->>'before_text' = '' OR strpos(reconstructed,f->>'before_text') = 0 THEN
          RAISE EXCEPTION 'summary_review: before_text_not_found'; END IF;
        -- 全一致箇所の置換。根拠が全箇所をカバーしない場合は検証器が拒否する。
        reconstructed := replace(reconstructed,f->>'before_text',f->>'after_text');
      END IF;
    END LOOP;
    IF reconstructed IS DISTINCT FROM p_summary_text THEN RAISE EXCEPTION 'summary_review: unlogged_change'; END IF;
  END;
  FOR f IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    n := n + 1;
    INSERT INTO public.summary_review_log(review_run_id,stream_id,finding_no,finding_type,rule_id,
      field,excerpt,before_text,after_text,evidence,confidence)
    VALUES (p_review_run_id,p_stream_id,n,f->>'finding_type',f->>'rule_id',f->>'field',
      f->>'excerpt',f->>'before_text',f->>'after_text',f->>'evidence',f->>'confidence');
  END LOOP;
  UPDATE public.streams SET summary=p_summary_text,summary_review_base_status=p_new_status,
    summary_review_status=p_new_status WHERE id=p_stream_id;
  final_state := CASE WHEN p_new_status='review_failed' THEN 'failed' ELSE 'succeeded' END;
  UPDATE public.summary_review_runs SET state=final_state,result_payload=payload,finished_at=now()
    WHERE review_run_id=p_review_run_id;
  RETURN jsonb_build_object('state',final_state,'replayed',false);
END;
$$;

-- 両値の明示指定を検証する入力境界。triggerはOLD/NEWによる状態契約の裏側の防護。
CREATE OR REPLACE FUNCTION public.update_summary_review_state(
  p_stream_id uuid, p_expected_version bigint, p_is_reviewed boolean, p_status text, p_base text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  s public.streams%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.streams WHERE id = p_stream_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'summary_review: stream_not_found'; END IF;
  -- 全パラメータ明示が契約。NULL boolの正規化は行わず、版NULLもfail-closed。
  IF p_expected_version IS NULL OR p_is_reviewed IS NULL OR p_status IS NULL OR p_base IS NULL THEN
    RAISE EXCEPTION 'summary_review: state_params_required';
  END IF;
  IF s.summary_review_version <> p_expected_version THEN
    RAISE EXCEPTION 'summary_review: version_conflict';
  END IF;
  -- statusのみconfirmedを追加で許す。baseは常に未確認6状態の復元点。
  IF p_status NOT IN ('legacy_unreviewed','pending','reviewed_no_change','auto_fixed',
                      'needs_review','review_failed','confirmed')
     OR p_base NOT IN ('legacy_unreviewed','pending','reviewed_no_change','auto_fixed',
                      'needs_review','review_failed') THEN
    RAISE EXCEPTION 'summary_review: invalid_state';
  END IF;
  IF (p_is_reviewed AND p_status <> 'confirmed')
     OR (NOT p_is_reviewed AND p_status IS DISTINCT FROM p_base) THEN
    RAISE EXCEPTION 'summary_review: contradictory_status_base_update';
  END IF;
  -- expected_versionは行ロック下の時点ガードであり、状態ラベルのみの変更は版を増やさない。
  -- bool変更は既存triggerの規則で版が増える。本文/字幕/成功歴には一切書き込まない。
  UPDATE public.streams SET is_reviewed = p_is_reviewed,
    summary_review_status = p_status, summary_review_base_status = p_base
    WHERE id = p_stream_id;
END;
$$;

-- RLSもtable権限も非公開。service_roleの書込みもRPCに限定する。
ALTER TABLE public.summary_review_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summary_review_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.summary_review_runs, public.summary_review_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.summary_review_runs, public.summary_review_log TO service_role;
CREATE POLICY summary_review_runs_service_read ON public.summary_review_runs FOR SELECT TO service_role USING (true);
CREATE POLICY summary_review_log_service_read ON public.summary_review_log FOR SELECT TO service_role USING (true);
-- 026の列単位SELECTを維持。新しい内部列へのSELECTは付与しない。
GRANT SELECT (summary_review_status) ON public.streams TO anon, authenticated;

REVOKE ALL ON FUNCTION public.sync_summary_review_confirmed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_generated_summary(uuid,bigint,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_summary_review_run(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_summary_review_run(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_generated_summary(uuid,bigint,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_summary_review_run(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_summary_review_run(uuid,uuid,uuid,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.update_summary_review_state(uuid,bigint,boolean,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_summary_review_state(uuid,bigint,boolean,text,text) TO service_role;

-- M-2 EXECUTION TESTS: 適用時に自動実行するテスト。RAISEによるアサート失敗はmigration失敗。
-- fixtureは001_initial_schema.sqlの必須列video_id/title/stream_date＋検証対象列のみ。
-- 各ケースのネストBEGIN/EXCEPTIONで、成功時も専用SQLSTATEの例外により挿入行をrollback。
-- 予期しない例外は握り潰さず伝播し、外側のmigrationトランザクションも失敗させる。
DO $m2_tests$
DECLARE
  states text[] := ARRAY['legacy_unreviewed','pending','reviewed_no_change',
                         'auto_fixed','needs_review','review_failed'];
  sid uuid;
  st text;
  direction integer;
  i integer;
  s public.streams%ROWTYPE;
  v bigint;
  expected_error text;
  rpc_oid oid := 'public.update_summary_review_state(uuid,bigint,boolean,text,text)'::regprocedure;
BEGIN
  -- backfill/CHECK/RLS: fixtureを作る前に既存行の整合を確認（0行なら自明に通過）。
  IF EXISTS (SELECT 1 FROM public.streams WHERE NOT is_reviewed
             AND summary_review_status IS DISTINCT FROM summary_review_base_status) THEN
    RAISE EXCEPTION 'summary_review_test: backfill_pair_integrity';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.streams'::regclass AND contype = 'c' AND convalidated
        AND conname IN ('streams_review_status_check','streams_is_reviewed_confirmed_iff')) <> 2 THEN
    RAISE EXCEPTION 'summary_review_test: required_checks';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE relrowsecurity
      AND oid IN ('public.summary_review_runs'::regclass,'public.summary_review_log'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'summary_review_test: rls_enabled';
  END IF;
  -- 実効ACL検査。ロール切替はせず、PUBLICのEXECUTEも展開して明示確認する。
  IF pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
                  LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
                WHERE p.oid = rpc_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'summary_review_test: rpc_service_role_only';
  END IF;

  -- INSERT: 矛盾ペアの両方向をSQLERRM完全一致で拒否。
  FOR direction IN 1..2 LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      BEGIN
        INSERT INTO public.streams(id,video_id,title,stream_date,is_reviewed,
                                  summary_review_status,summary_review_base_status)
        VALUES (sid,sid::text,'M-2 INSERT reject',DATE '2026-11-11',false,
                CASE direction WHEN 1 THEN 'legacy_unreviewed' ELSE 'pending' END,
                CASE direction WHEN 1 THEN 'pending' ELSE 'legacy_unreviewed' END);
        RAISE EXCEPTION 'summary_review_test: insert_expected_rejection';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'summary_review: contradictory_status_base_insert' THEN RAISE; END IF;
      END;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  FOREACH st IN ARRAY states LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date,is_reviewed,
                                summary_review_status,summary_review_base_status)
      VALUES (sid,sid::text,'M-2 INSERT matching',DATE '2026-11-11',false,st,st)
      RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM st OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.is_reviewed IS DISTINCT FROM false OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: insert_matching_six_states';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date,is_reviewed,
                                summary_review_status,summary_review_base_status)
      VALUES (sid,sid::text,'M-2 INSERT confirmed',DATE '2026-11-11',true,'confirmed',st)
      RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM 'confirmed' OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.is_reviewed IS DISTINCT FROM true OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: insert_confirmed_base_kept';
      END IF;
      UPDATE public.streams SET is_reviewed = false WHERE id = sid RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM st OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.is_reviewed IS DISTINCT FROM false OR s.summary_review_version <> 1 THEN
        RAISE EXCEPTION 'summary_review_test: insert_confirmed_restore';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  -- UPDATE直接: 両列が実際に変わる矛盾入力の両方向。
  FOR direction IN 1..2 LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date)
      VALUES (sid,sid::text,'M-2 UPDATE reject',DATE '2026-11-11');
      BEGIN
        UPDATE public.streams SET
          summary_review_status = CASE direction WHEN 1 THEN 'pending' ELSE 'review_failed' END,
          summary_review_base_status = CASE direction WHEN 1 THEN 'review_failed' ELSE 'pending' END
          WHERE id = sid;
        RAISE EXCEPTION 'summary_review_test: update_expected_rejection';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'summary_review: contradictory_status_base_update' THEN RAISE; END IF;
      END;
      SELECT * INTO STRICT s FROM public.streams WHERE id = sid;
      IF s.summary_review_status IS DISTINCT FROM 'legacy_unreviewed'
         OR s.summary_review_base_status IS DISTINCT FROM 'legacy_unreviewed' OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: update_reject_atomic';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  FOREACH st IN ARRAY states LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date)
      VALUES (sid,sid::text,'M-2 UPDATE transitions',DATE '2026-11-11');
      UPDATE public.streams SET summary_review_status = st WHERE id = sid RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM st OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: status_only_sync';
      END IF;
      UPDATE public.streams SET summary_review_status = 'pending', summary_review_base_status = 'pending'
        WHERE id = sid;
      UPDATE public.streams SET summary_review_base_status = st WHERE id = sid RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM st OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: base_only_sync';
      END IF;
      UPDATE public.streams SET summary_review_status = CASE WHEN st = 'pending' THEN 'review_failed' ELSE 'pending' END
        WHERE id = sid;
      UPDATE public.streams SET summary_review_status = st, summary_review_base_status = st
        WHERE id = sid RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM st OR s.summary_review_base_status IS DISTINCT FROM st
         OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: update_matching_pair';
      END IF;
      UPDATE public.streams SET is_reviewed = true WHERE id = sid RETURNING * INTO s;
      IF s.is_reviewed IS DISTINCT FROM true OR s.summary_review_status IS DISTINCT FROM 'confirmed'
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 1 THEN
        RAISE EXCEPTION 'summary_review_test: bool_only_confirm';
      END IF;
      UPDATE public.streams SET is_reviewed = false WHERE id = sid RETURNING * INTO s;
      IF s.is_reviewed IS DISTINCT FROM false OR s.summary_review_status IS DISTINCT FROM st
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 2 THEN
        RAISE EXCEPTION 'summary_review_test: bool_only_restore';
      END IF;
      -- baseを確実に異なる値へ戻してからconfirmed遷移＋復元点の同時指定を試す。
      UPDATE public.streams SET summary_review_status = CASE WHEN st = 'pending' THEN 'review_failed' ELSE 'pending' END
        WHERE id = sid;
      UPDATE public.streams SET is_reviewed = true, summary_review_status = 'confirmed',
        summary_review_base_status = st WHERE id = sid RETURNING * INTO s;
      IF s.is_reviewed IS DISTINCT FROM true OR s.summary_review_status IS DISTINCT FROM 'confirmed'
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 3 THEN
        RAISE EXCEPTION 'summary_review_test: confirmed_transition_with_base';
      END IF;
      UPDATE public.streams SET is_reviewed = false WHERE id = sid RETURNING * INTO s;
      IF s.is_reviewed IS DISTINCT FROM false OR s.summary_review_status IS DISTINCT FROM st
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 4 THEN
        RAISE EXCEPTION 'summary_review_test: confirmed_transition_restore';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  -- 同値SETは状態契約上no-op。両値明示の意図を検査したい場合はRPCを使う。
  FOR direction IN 1..2 LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date)
      VALUES (sid,sid::text,'M-2 same-value SET',DATE '2026-11-11');
      UPDATE public.streams SET
        summary_review_status = CASE direction WHEN 1 THEN 'pending' ELSE 'legacy_unreviewed' END,
        summary_review_base_status = CASE direction WHEN 1 THEN 'legacy_unreviewed' ELSE 'pending' END
        WHERE id = sid RETURNING * INTO s;
      IF s.summary_review_status IS DISTINCT FROM 'pending' OR s.summary_review_base_status IS DISTINCT FROM 'pending'
         OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: same_value_set_is_state_noop';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  BEGIN
    sid := pg_catalog.gen_random_uuid();
    INSERT INTO public.streams(id,video_id,title,stream_date)
    VALUES (sid,sid::text,'M-2 ABA/version',DATE '2026-11-11');
    UPDATE public.streams SET summary = 'A' WHERE id = sid;
    UPDATE public.streams SET summary = 'B' WHERE id = sid;
    UPDATE public.streams SET summary = 'A' WHERE id = sid RETURNING * INTO s;
    IF s.summary IS DISTINCT FROM 'A' OR s.summary_review_version <> 3 THEN
      RAISE EXCEPTION 'summary_review_test: aba_version_detection';
    END IF;
    v := s.summary_review_version;
    UPDATE public.streams SET summary_review_version = 0 WHERE id = sid RETURNING * INTO s;
    IF s.summary_review_version IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'summary_review_test: version_monotonic';
    END IF;
    UPDATE public.streams SET transcript = 'changed' WHERE id = sid RETURNING * INTO s;
    IF s.summary_review_version <> v + 1 THEN
      RAISE EXCEPTION 'summary_review_test: transcript_version_increment';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
  END;

  -- RPC: 両値不一致（旧値同値の明示指定を含む）・版・NULL・不正状態を入力境界で拒否。
  FOR i IN 1..13 LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date)
      VALUES (sid,sid::text,'M-2 RPC reject',DATE '2026-11-11');
      expected_error := CASE
        WHEN i IN (1,2,3,12) THEN 'summary_review: contradictory_status_base_update'
        WHEN i = 4 THEN 'summary_review: version_conflict'
        WHEN i IN (5,6,7,8) THEN 'summary_review: state_params_required'
        WHEN i IN (9,10) THEN 'summary_review: invalid_state'
        ELSE 'summary_review: stream_not_found' END;
      BEGIN
        PERFORM public.update_summary_review_state(
          CASE WHEN i = 11 THEN pg_catalog.gen_random_uuid() WHEN i = 13 THEN NULL ELSE sid END,
          CASE WHEN i = 4 THEN 1 WHEN i = 8 THEN NULL ELSE 0 END,
          CASE WHEN i = 5 THEN NULL WHEN i = 3 THEN true ELSE false END,
          CASE WHEN i IN (1,3) THEN 'pending' WHEN i = 6 THEN NULL
               WHEN i = 9 THEN 'invalid' WHEN i = 12 THEN 'confirmed' ELSE 'legacy_unreviewed' END,
          CASE WHEN i = 2 THEN 'pending' WHEN i = 7 THEN NULL
               WHEN i = 10 THEN 'confirmed' ELSE 'legacy_unreviewed' END);
        RAISE EXCEPTION 'summary_review_test: rpc_expected_rejection';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM expected_error THEN RAISE; END IF;
      END;
      SELECT * INTO STRICT s FROM public.streams WHERE id = sid;
      IF s.is_reviewed IS DISTINCT FROM false OR s.summary_review_status IS DISTINCT FROM 'legacy_unreviewed'
         OR s.summary_review_base_status IS DISTINCT FROM 'legacy_unreviewed' OR s.summary_review_version <> 0 THEN
        RAISE EXCEPTION 'summary_review_test: rpc_reject_atomic';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;

  FOREACH st IN ARRAY states LOOP
    BEGIN
      sid := pg_catalog.gen_random_uuid();
      INSERT INTO public.streams(id,video_id,title,stream_date)
      VALUES (sid,sid::text,'M-2 RPC matching',DATE '2026-11-11');
      -- 本文/字幕を持たせて、state RPCが両方を不変に保つことも検証する。
      UPDATE public.streams SET summary = 'M-2 summary', transcript = 'M-2 transcript' WHERE id = sid;
      PERFORM public.update_summary_review_state(sid,1,false,st,st);
      SELECT * INTO STRICT s FROM public.streams WHERE id = sid;
      IF s.is_reviewed IS DISTINCT FROM false OR s.summary_review_status IS DISTINCT FROM st
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 1
         OR s.summary IS DISTINCT FROM 'M-2 summary' OR s.transcript IS DISTINCT FROM 'M-2 transcript' THEN
        RAISE EXCEPTION 'summary_review_test: rpc_matching_pair_state_only_version';
      END IF;
      PERFORM public.update_summary_review_state(sid,1,true,'confirmed',st);
      SELECT * INTO STRICT s FROM public.streams WHERE id = sid;
      IF s.is_reviewed IS DISTINCT FROM true OR s.summary_review_status IS DISTINCT FROM 'confirmed'
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 2 THEN
        RAISE EXCEPTION 'summary_review_test: rpc_confirmed_base_kept';
      END IF;
      PERFORM public.update_summary_review_state(sid,2,false,st,st);
      SELECT * INTO STRICT s FROM public.streams WHERE id = sid;
      IF s.is_reviewed IS DISTINCT FROM false OR s.summary_review_status IS DISTINCT FROM st
         OR s.summary_review_base_status IS DISTINCT FROM st OR s.summary_review_version <> 3
         OR s.summary IS DISTINCT FROM 'M-2 summary' OR s.transcript IS DISTINCT FROM 'M-2 transcript' THEN
        RAISE EXCEPTION 'summary_review_test: rpc_restore';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'summary_review_test: rollback';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM IS DISTINCT FROM 'summary_review_test: rollback' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$m2_tests$ LANGUAGE plpgsql;
COMMIT;
