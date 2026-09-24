import io
import json
import os
import pathlib
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import check_migration_drift as cmd  # noqa: E402


class _StubHandler(BaseHTTPRequestHandler):
    status_code = 200
    body = b"[]"
    last_path = None
    last_auth = None

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler convention)
        type(self).last_path = self.path
        type(self).last_auth = self.headers.get("Authorization")
        self.send_response(type(self).status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(type(self).body)

    def log_message(self, *args):  # テスト出力を汚さない
        pass


class StubApiMixin(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.api_base = "http://{}:{}".format(host, port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class CollectLocalVersionsTests(unittest.TestCase):
    def test_parses_versions_and_ignores_non_sql(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in [
                "001_initial_schema.sql",
                "20260908063934_add_whisper_transcribe_kind.sql",
                "README.md",
            ]:
                pathlib.Path(tmp, name).write_text("-- test\n", encoding="utf-8")
            versions = cmd.collect_local_versions(tmp)
        self.assertEqual(sorted(versions), ["001", "20260908063934"])
        self.assertEqual(versions["001"], ["001_initial_schema.sql"])

    def test_detects_duplicates_and_unparsable(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ["001_a.sql", "001_b.sql", "manual_fix.sql"]:
                pathlib.Path(tmp, name).write_text("-- test\n", encoding="utf-8")
            versions = cmd.collect_local_versions(tmp)
        report = cmd.compare_versions(versions, [])
        self.assertEqual(sorted(report["duplicates"]), ["001"])
        self.assertEqual(report["unparsable"], ["manual_fix.sql"])
        self.assertEqual(report["local_count"], 1)


class CompareVersionsTests(unittest.TestCase):
    def test_equal_sets_have_no_drift(self):
        report = cmd.compare_versions(
            {"001": ["001_a.sql"], "002": ["002_b.sql"]},
            [{"version": "001", "name": "a"}, {"version": "002", "name": "b"}],
        )
        self.assertIn("結果: OK", cmd.format_report(report))

    def test_remote_only_and_local_only(self):
        report = cmd.compare_versions(
            {"001": ["001_a.sql"], "003": ["003_c.sql"]},
            [
                {"version": "001", "name": "a"},
                {"version": "20260707224525", "name": "fix_function_search_path"},
            ],
        )
        self.assertEqual(report["remote_only"], ["20260707224525"])
        self.assertEqual(report["local_only"], ["003"])
        text = cmd.format_report(report)
        self.assertIn("結果: DRIFT DETECTED", text)
        self.assertIn("fix_function_search_path", text)
        self.assertIn("003_c.sql", text)


class FetchRemoteMigrationsTests(StubApiMixin):
    def test_success(self):
        _StubHandler.status_code = 200
        _StubHandler.body = json.dumps([{"version": "001", "name": "initial"}]).encode()
        result = cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")
        self.assertEqual(result, [{"version": "001", "name": "initial"}])
        self.assertEqual(_StubHandler.last_path, "/v1/projects/dummy-ref/database/migrations")
        self.assertEqual(_StubHandler.last_auth, "Bearer dummy-token")

    def test_unauthorized_raises(self):
        _StubHandler.status_code = 401
        _StubHandler.body = b"{}"
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")

    def test_server_error_raises(self):
        _StubHandler.status_code = 500
        _StubHandler.body = b"{}"
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")

    def test_invalid_json_raises(self):
        _StubHandler.status_code = 200
        _StubHandler.body = b"not-json"
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")


class MainEndToEndTests(StubApiMixin):
    def _run(self, argv):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            try:
                code = cmd.main(argv)
            except SystemExit as exc:  # argparse経由の終了も拾う
                code = exc.code
        return code, stdout.getvalue(), stderr.getvalue()

    def test_exit_zero_when_no_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "001_initial_schema.sql").write_text("-- test\n", encoding="utf-8")
            _StubHandler.status_code = 200
            _StubHandler.body = json.dumps([{"version": "001", "name": "initial"}]).encode()
            code, stdout, _ = self._run(
                [
                    "--project-ref",
                    "dummy-ref",
                    "--token",
                    "dummy-token",
                    "--local-dir",
                    tmp,
                    "--api-base",
                    self.api_base,
                ]
            )
        self.assertEqual(code, 0)
        self.assertIn("結果: OK", stdout)

    def test_exit_one_when_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "001_initial_schema.sql").write_text("-- test\n", encoding="utf-8")
            _StubHandler.status_code = 200
            _StubHandler.body = json.dumps(
                [{"version": "001", "name": "initial"}, {"version": "002", "name": "remote-only"}]
            ).encode()
            code, stdout, _ = self._run(
                [
                    "--project-ref",
                    "dummy-ref",
                    "--token",
                    "dummy-token",
                    "--local-dir",
                    tmp,
                    "--api-base",
                    self.api_base,
                ]
            )
        self.assertEqual(code, 1)
        self.assertIn("結果: DRIFT DETECTED", stdout)

    def test_exit_two_without_token(self):
        saved = os.environ.pop(cmd.ENV_TOKEN, None)
        try:
            code, _, stderr = self._run(
                ["--project-ref", "dummy-ref", "--local-dir", "supabase/migrations"]
            )
        finally:
            if saved is not None:
                os.environ[cmd.ENV_TOKEN] = saved
        self.assertEqual(code, 2)
        self.assertIn(cmd.ENV_TOKEN, stderr)


if __name__ == "__main__":
    unittest.main()
