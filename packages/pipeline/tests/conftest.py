"""
reprocess_videos.py / summarize.py / store.py の冪等再開ロジック用テストインフラ。

Supabase-py の postgrest クエリビルダをごく小さく模した FakeSupabaseClient を提供する。
実DBには一切接続しない。対応しているのは本プロダクションコードが実際に使っている
チェーン（select/eq/neq/is_/not_.is_/or_/in_/order/limit/update/insert/delete/upsert/rpc）のみ。
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import tenacity

PIPELINE_DIR = Path(__file__).resolve().parent.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import summarize  # noqa: E402
from google.genai import errors as genai_errors  # noqa: E402


# ---------------------------------------------------------------------------
# 429 エラー生成ヘルパー
# ---------------------------------------------------------------------------

def make_api_error(message: str, code: int = 429, status: str = "RESOURCE_EXHAUSTED") -> genai_errors.APIError:
    """genai_errors.APIError の実インスタンスを組み立てる。

    summarize.should_retry_gemini_exception() は isinstance(error, genai_errors.APIError) を
    見るため、ただの Mock ではなく実クラスのインスタンスである必要がある。
    """
    response_json = {"code": code, "status": status, "message": message}
    return genai_errors.APIError(code, response_json)


def make_fake_gemini(generate_content_side_effect=None):
    """model.models.generate_content(...) を持つダミーの Gemini クライアント。"""
    from unittest.mock import MagicMock

    generate_content = MagicMock()
    if generate_content_side_effect is not None:
        generate_content.side_effect = generate_content_side_effect
    return SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))


# ---------------------------------------------------------------------------
# Fake Supabase client
# ---------------------------------------------------------------------------

class _Response:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


def _parse_or_condition(cond: str):
    col, op, val = cond.split(".", 2)
    if op == "eq":
        return lambda row: row.get(col) == val
    if op == "neq":
        return lambda row: row.get(col) != val
    if op == "is":
        if val == "null":
            return lambda row: row.get(col) is None
        if val == "true":
            return lambda row: row.get(col) is True
        if val == "false":
            return lambda row: row.get(col) is False
        raise NotImplementedError(f"unsupported is value: {val}")
    raise NotImplementedError(f"unsupported or_ condition: {cond}")


class _NotProxy:
    def __init__(self, query):
        self._query = query

    def is_(self, col, val):
        pred = _parse_or_condition(f"{col}.is.{val}")
        self._query._predicates.append(lambda row: not pred(row))
        return self._query


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.mode = "select"
        self._predicates = []
        self._select_count = None
        self._order = []
        self._limit = None
        self._payload = None

    # --- filters -----------------------------------------------------
    def select(self, columns="*", count=None):
        self._select_count = count
        return self

    def eq(self, col, val):
        self._predicates.append(lambda row: row.get(col) == val)
        return self

    def neq(self, col, val):
        self._predicates.append(lambda row: row.get(col) != val)
        return self

    def is_(self, col, val):
        self._predicates.append(_parse_or_condition(f"{col}.is.{val}"))
        return self

    def in_(self, col, values):
        vals = set(values)
        self._predicates.append(lambda row: row.get(col) in vals)
        return self

    def or_(self, expr):
        parts = [p.strip() for p in expr.split(",")]
        preds = [_parse_or_condition(p) for p in parts]
        self._predicates.append(lambda row: any(p(row) for p in preds))
        return self

    @property
    def not_(self):
        return _NotProxy(self)

    def order(self, col, desc=False):
        self._order.append((col, desc))
        return self

    def limit(self, n):
        self._limit = n
        return self

    # --- write operations ---------------------------------------------
    def update(self, payload):
        self.mode = "update"
        self._payload = payload
        return self

    def insert(self, payload):
        self.mode = "insert"
        self._payload = payload
        return self

    def delete(self):
        self.mode = "delete"
        return self

    def upsert(self, payload, on_conflict=None):
        self.mode = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    # --- execute --------------------------------------------------------
    def execute(self):
        table_rows = self.client.db.setdefault(self.table_name, [])
        matched = [row for row in table_rows if all(p(row) for p in self._predicates)]

        if self.mode == "select":
            rows = list(matched)
            for col, desc in reversed(self._order):
                rows.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
            count = len(rows) if self._select_count else None
            if self._limit is not None:
                rows = rows[: self._limit]
            result = [dict(r) for r in rows]
            self.client.calls.append(SimpleNamespace(table=self.table_name, mode="select"))
            return _Response(result, count=count)

        if self.mode == "update":
            for row in matched:
                row.update(self._payload)
            updated = [dict(r) for r in matched]
            self.client.update_calls.append(
                {"table": self.table_name, "payload": dict(self._payload), "rows": updated}
            )
            return _Response(updated)

        if self.mode == "delete":
            deleted = [dict(r) for r in matched]
            for row in matched:
                table_rows.remove(row)
            self.client.delete_calls.append({"table": self.table_name, "rows": deleted})
            return _Response(deleted)

        if self.mode == "insert":
            payload = self._payload
            rows_to_insert = payload if isinstance(payload, list) else [payload]
            inserted = []
            for row in rows_to_insert:
                new_row = dict(row)
                new_row.setdefault("id", self.client.next_id(self.table_name))
                table_rows.append(new_row)
                inserted.append(dict(new_row))
            self.client.insert_calls.append({"table": self.table_name, "rows": inserted})
            return _Response(inserted)

        if self.mode == "upsert":
            key = self._on_conflict or "id"
            payload = self._payload
            existing_row = next((r for r in table_rows if r.get(key) == payload.get(key)), None)
            if existing_row is not None:
                existing_row.update(payload)
                result_row = dict(existing_row)
            else:
                result_row = dict(payload)
                result_row.setdefault("id", self.client.next_id(self.table_name))
                table_rows.append(result_row)
            self.client.upsert_calls.append({"table": self.table_name, "payload": dict(payload)})
            return _Response([dict(result_row)])

        raise NotImplementedError(self.mode)


class FakeRpc:
    def __init__(self, client, fn, params):
        self.client = client
        self.fn = fn
        self.params = params

    def execute(self):
        self.client.rpc_calls.append({"fn": self.fn, "params": self.params})
        handler = self.client.rpc_handlers.get(self.fn)
        if handler is None:
            raise RuntimeError(f"no rpc handler configured for '{self.fn}' (params={self.params})")
        return _Response(handler(self.params))


class FakeSupabaseClient:
    def __init__(self):
        self.db: dict[str, list[dict]] = {}
        self.calls: list = []
        self.update_calls: list[dict] = []
        self.delete_calls: list[dict] = []
        self.insert_calls: list[dict] = []
        self.upsert_calls: list[dict] = []
        self.rpc_calls: list[dict] = []
        self.rpc_handlers: dict = {}
        self._id_counters: dict[str, int] = {}

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, fn, params):
        return FakeRpc(self, fn, params)

    def next_id(self, table_name):
        self._id_counters[table_name] = self._id_counters.get(table_name, 0) + 1
        return f"{table_name}-{self._id_counters[table_name]}"

    def seed(self, table_name, *rows):
        self.db.setdefault(table_name, []).extend(dict(r) for r in rows)


# ---------------------------------------------------------------------------
# ドメインヘルパー
# ---------------------------------------------------------------------------

def make_stream_row(**overrides):
    row = {
        "id": "stream-1",
        "video_id": "vid-1",
        "transcript": "既存のtranscriptテキスト",
        "is_reviewed": False,
        "status": "public",
        "stream_date": "2026-07-01",
        "ai_prompt_ver": None,
        "summary": None,
    }
    row.update(overrides)
    return row


def make_ai_result(chapters=None, **overrides):
    result = {
        "summary": "要約テキスト",
        "chapters": chapters if chapters is not None else [
            {"start_sec": 0, "title": "チャプター1", "summary": "内容1"}
        ],
        "corner_names": [],
        "guests": [],
        "tags": [],
        "songs": [],
        "talk_topics": [],
        "has_live_singing": False,
        "highlights": [],
    }
    result.update(overrides)
    return result


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_supabase():
    return FakeSupabaseClient()


@pytest.fixture(autouse=True)
def fast_gemini_retry():
    """summarize._generate_with_retry の待機時間をゼロにして tenacity のリトライテストを高速化する。"""
    original_wait = summarize._generate_with_retry.retry.wait
    summarize._generate_with_retry.retry.wait = tenacity.wait_none()
    yield
    summarize._generate_with_retry.retry.wait = original_wait
