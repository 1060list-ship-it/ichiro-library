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
    routes = {}
    status_code = 200
    body = b"[]"
    requests = []

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler convention)
        type(self).requests.append((self.path, self.headers.get("Authorization")))
        status, body = type(self).routes.get(
            self.path, (type(self).status_code, type(self).body)
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # テスト出力を汚さない
        pass


class StubApiMixin(unittest.TestCase):
    def setUp(self):
        _StubHandler.routes = {}
        _StubHandler.status_code = 200
        _StubHandler.body = b"[]"
        _StubHandler.requests = []
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


class LocalOnlyAllowlistTests(unittest.TestCase):
    def test_loads_versions_with_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp, "local-only-migrations.txt")
            path.write_text(
                "# comment\n\n20260621060000  # 014b: local replay only\n"
                "20260718100000\n",
                encoding="utf-8",
            )
            allowlist = cmd.load_local_only_allowlist(str(path))
        self.assertEqual(
            allowlist,
            {
                "20260621060000": "014b: local replay only",
                "20260718100000": "",
            },
        )

    def test_missing_file_returns_empty(self):
        self.assertEqual(cmd.load_local_only_allowlist("/nonexistent/file.txt"), {})


class NormalizeSqlTests(unittest.TestCase):
    def test_normalizes_comments_whitespace_and_semicolon(self):
        text = "-- comment\nALTER TABLE streams\n  DROP COLUMN has_live_viewing;\n"
        self.assertEqual(cmd.normalize_sql(text), "ALTER TABLE streams DROP COLUMN has_live_viewing")

    def test_compare_match(self):
        remote = ["ALTER TABLE streams DROP COLUMN has_live_viewing"]
        local = "-- 034\nALTER TABLE streams DROP COLUMN has_live_viewing;\n"
        self.assertEqual(cmd.compare_sql_content(remote, local), "match")

    def test_compare_differs(self):
        remote = ["ALTER TABLE streams DROP COLUMN other_column"]
        local = "ALTER TABLE streams DROP COLUMN has_live_viewing;\n"
        self.assertEqual(cmd.compare_sql_content(remote, local), "differs")

    def test_compare_unavailable(self):
        self.assertEqual(cmd.compare_sql_content([], "SELECT 1;"), "unavailable")
        self.assertEqual(cmd.compare_sql_content(None, "SELECT 1;"), "unavailable")


class CompareVersionsTests(unittest.TestCase):
    def test_equal_sets_have_no_drift(self):
        report = cmd.compare_versions(
            {"001": ["001_a.sql"], "002": ["002_b.sql"]},
            [{"version": "001", "name": "a"}, {"version": "002", "name": "b"}],
        )
        self.assertIn("結果: OK", cmd.format_report(report))
        self.assertFalse(cmd.has_drift(report))

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

    def test_allowlisted_local_only_is_exception_not_drift(self):
        report = cmd.compare_versions(
            {"001": ["001_a.sql"], "20260621060000": ["20260621060000_014b.sql"]},
            [{"version": "001", "name": "a"}],
            {"20260621060000": "014b: local replay only"},
        )
        self.assertEqual(report["local_only"], [])
        self.assertEqual(report["local_only_exceptions"], ["20260621060000"])
        self.assertFalse(cmd.has_drift(report))
        text = cmd.format_report(report)
        self.assertIn("結果: OK（意図的なローカル専用1件を除く）", text)
        self.assertIn("014b: local replay only", text)


class FindLocalFileTests(unittest.TestCase):
    def test_matches_by_name_suffix(self):
        local = {
            "20260718100000": ["20260718100000_034_drop_live_viewing_flag.sql"],
            "001": ["001_initial_schema.sql"],
        }
        self.assertEqual(
            cmd.find_local_file_for_remote_name("034_drop_live_viewing_flag", local),
            ("20260718100000", "20260718100000_034_drop_live_viewing_flag.sql"),
        )
        self.assertIsNone(cmd.find_local_file_for_remote_name("unknown", local))
        self.assertIsNone(cmd.find_local_file_for_remote_name("", local))


class FetchRemoteMigrationsTests(StubApiMixin):
    def test_success(self):
        _StubHandler.body = json.dumps([{"version": "001", "name": "initial"}]).encode()
        result = cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")
        self.assertEqual(result, [{"version": "001", "name": "initial"}])
        self.assertEqual(_StubHandler.requests[-1][0], "/v1/projects/dummy-ref/database/migrations")
        self.assertEqual(_StubHandler.requests[-1][1], "Bearer dummy-token")

    def test_unauthorized_raises(self):
        _StubHandler.status_code = 401
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")

    def test_server_error_raises(self):
        _StubHandler.status_code = 500
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")

    def test_invalid_json_raises(self):
        _StubHandler.body = b"not-json"
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migrations(self.api_base, "dummy-ref", "dummy-token")


class FetchRemoteMigrationDetailTests(StubApiMixin):
    def test_success(self):
        _StubHandler.routes = {
            "/v1/projects/dummy-ref/database/migrations/20260718024607": (
                200,
                json.dumps({"version": "20260718024607", "statements": ["SELECT 1"]}).encode(),
            )
        }
        detail = cmd.fetch_remote_migration_detail(
            self.api_base, "dummy-ref", "dummy-token", "20260718024607"
        )
        self.assertEqual(detail["statements"], ["SELECT 1"])

    def test_non_dict_payload_raises(self):
        _StubHandler.body = json.dumps(["unexpected"]).encode()
        with self.assertRaises(cmd.DriftCheckError):
            cmd.fetch_remote_migration_detail(
                self.api_base, "dummy-ref", "dummy-token", "20260718024607"
            )


class FormatReportTests(unittest.TestCase):
    def _report_with_remote_only(self, content):
        report = cmd.compare_versions(
            {"20260718100000": ["20260718100000_034_drop_live_viewing_flag.sql"]},
            [{"version": "20260718024607", "name": "034_drop_live_viewing_flag"}],
        )
        report["remote_only_details"] = {
            "20260718024607": {
                "name": "034_drop_live_viewing_flag",
                "local_file": "20260718100000_034_drop_live_viewing_flag.sql",
                "content": content,
                "note": "" if content != "unavailable" else "本番側のstatementsが取得できません",
            }
        }
        return report

    def test_match_line(self):
        text = cmd.format_report(self._report_with_remote_only("match"))
        self.assertIn("内容: match", text)

    def test_differs_line(self):
        text = cmd.format_report(self._report_with_remote_only("differs"))
        self.assertIn("内容: **differs**", text)

    def test_unavailable_line(self):
        text = cmd.format_report(self._report_with_remote_only("unavailable"))
        self.assertIn("unavailable", text)


class MainEndToEndTests(StubApiMixin):
    def _run(self, argv):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            try:
                code = cmd.main(argv)
            except SystemExit as exc:  # argparse経由の終了も拾う
                code = exc.code
        return code, stdout.getvalue(), stderr.getvalue()

    def _argv(self, local_dir, local_only_file=None):
        argv = [
            "--project-ref",
            "dummy-ref",
            "--token",
            "dummy-token",
            "--local-dir",
            local_dir,
            "--api-base",
            self.api_base,
        ]
        if local_only_file:
            argv += ["--local-only-file", local_only_file]
        return argv

    def test_exit_zero_when_no_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "001_initial_schema.sql").write_text("-- test\n", encoding="utf-8")
            _StubHandler.body = json.dumps([{"version": "001", "name": "initial"}]).encode()
            code, stdout, _ = self._run(self._argv(tmp))
        self.assertEqual(code, 0)
        self.assertIn("結果: OK", stdout)

    def test_exit_one_when_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "001_initial_schema.sql").write_text("-- test\n", encoding="utf-8")
            _StubHandler.routes = {
                "/v1/projects/dummy-ref/database/migrations": (
                    200,
                    json.dumps(
                        [
                            {"version": "001", "name": "initial"},
                            {"version": "002", "name": "remote-only"},
                        ]
                    ).encode(),
                ),
                "/v1/projects/dummy-ref/database/migrations/002": (
                    200,
                    json.dumps({"version": "002", "statements": ["SELECT 1"]}).encode(),
                ),
            }
            code, stdout, _ = self._run(self._argv(tmp))
        self.assertEqual(code, 1)
        self.assertIn("結果: DRIFT DETECTED", stdout)

    def test_exit_zero_when_local_only_is_allowlisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "001_initial_schema.sql").write_text("-- test\n", encoding="utf-8")
            pathlib.Path(tmp, "20260621060000_014b_restore.sql").write_text(
                "ALTER TABLE streams ADD COLUMN IF NOT EXISTS has_live_singing BOOLEAN;\n",
                encoding="utf-8",
            )
            allowlist = pathlib.Path(tmp, "local-only-migrations.txt")
            allowlist.write_text("20260621060000 # 014b: local replay only\n", encoding="utf-8")
            _StubHandler.body = json.dumps([{"version": "001", "name": "initial"}]).encode()
            code, stdout, _ = self._run(self._argv(tmp, str(allowlist)))
        self.assertEqual(code, 0)
        self.assertIn("意図的なローカル専用1件を除く", stdout)

    def test_remote_only_match_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "20260718100000_034_drop_live_viewing_flag.sql").write_text(
                "ALTER TABLE streams DROP COLUMN has_live_viewing;\n", encoding="utf-8"
            )
            _StubHandler.routes = {
                "/v1/projects/dummy-ref/database/migrations": (
                    200,
                    json.dumps(
                        [{"version": "20260718024607", "name": "034_drop_live_viewing_flag"}]
                    ).encode(),
                ),
                "/v1/projects/dummy-ref/database/migrations/20260718024607": (
                    200,
                    json.dumps(
                        {
                            "version": "20260718024607",
                            "name": "034_drop_live_viewing_flag",
                            "statements": ["ALTER TABLE streams DROP COLUMN has_live_viewing"],
                        }
                    ).encode(),
                ),
            }
            code, stdout, _ = self._run(self._argv(tmp))
        self.assertEqual(code, 1)
        self.assertIn("内容: match", stdout)
        self.assertIn("合わせると整合", stdout)

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
