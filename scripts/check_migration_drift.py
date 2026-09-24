#!/usr/bin/env python3
"""ローカルmigrationファイルと本番Supabaseのmigration履歴のドリフトを検知する（読み取り専用）。

Supabase Management API を呼び、本番 schema_migrations に記録された version と
`supabase/migrations/*.sql` の filename prefix を突合する。

- remote_only: 本番にあるがローカルに無い version（Dashboard/SQLエディタからの直接適用など）
- local_only : ローカルにあるが本番に適用されていない version
- duplicate  : 同一 version prefix を持つローカルファイルが複数ある状態

remote_only については、同名のローカルファイルがあれば
GET /v1/projects/{ref}/database/migrations/{version} の statements と内容を正規化比較し、
match / differs / unavailable を報告する（filenameを本番versionへ合わせてよいかの判断材料）。

`supabase/local-only-migrations.txt`（任意）に version を列挙すると、
「意図的なローカル専用migration」として既知例外扱いにし、ドリフト判定から除外する
（レポートには理由付きで表示される）。

このスクリプトは本番DBへ接続しない・書き込まない（read-only）。
アクセストークンの値は出力しない。

終了コード:
  0: ドリフトなし（既知例外のみ）
  1: ドリフト検出
  2: 実行不能（トークン欠落・APIエラー・ネットワークエラー）
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Dict, List, Optional, Set, Tuple

DEFAULT_API_BASE = "https://api.supabase.com"
DEFAULT_LOCAL_DIR = "supabase/migrations"
DEFAULT_LOCAL_ONLY_FILE = "supabase/local-only-migrations.txt"
ENV_TOKEN = "SUPABASE_ACCESS_TOKEN"
ENV_PROJECT_REF = "SUPABASE_PROJECT_REF"

_VERSION_PREFIX = re.compile(r"^(\d+)")
_TIMEOUT_SECONDS = 30
_WHITESPACE = re.compile(r"\s+")


class DriftCheckError(Exception):
    """実行不能（設定・認証・ネットワーク・API応答の異常）。"""


def collect_local_versions(migrations_dir: str) -> Dict[str, List[str]]:
    """ローカルmigrationの version -> [filename, ...] を返す。"""
    versions: Dict[str, List[str]] = {}
    for name in sorted(os.listdir(migrations_dir)):
        if not name.endswith(".sql"):
            continue
        match = _VERSION_PREFIX.match(name)
        if not match:
            versions.setdefault("", []).append(name)
            continue
        versions.setdefault(match.group(1), []).append(name)
    return versions


def load_local_only_allowlist(path: str) -> Dict[str, str]:
    """意図的なローカル専用migrationの version -> 理由 を読み込む。無ければ空。"""
    if not path or not os.path.isfile(path):
        return {}
    allowlist: Dict[str, str] = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            version, _, reason = line.partition("#")
            version = version.strip()
            if version:
                allowlist[version] = reason.strip()
    return allowlist


def _request_json(url: str, token: str):
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer {}".format(token),
            "Accept": "application/json",
            "User-Agent": "ichiro-library-migration-drift-check",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        if status in (401, 403):
            raise DriftCheckError(
                "Management APIが認証を拒否しました（HTTP {}）。"
                "SUPABASE_ACCESS_TOKENの有効性と database 読み取り権限を確認してください。".format(status)
            )
        if status == 429:
            raise DriftCheckError("Management APIのレート制限に達しました（HTTP 429）。時間をおいて再実行してください。")
        raise DriftCheckError("Management APIがエラーを返しました（HTTP {}）。".format(status))
    except urllib.error.URLError as exc:
        raise DriftCheckError("Management APIへ接続できませんでした: {}".format(exc.reason))
    except ValueError as exc:
        raise DriftCheckError("Management APIの応答をJSONとして解釈できませんでした: {}".format(exc))


def fetch_remote_migrations(api_base: str, project_ref: str, token: str) -> List[dict]:
    """Management APIから本番の適用済みmigration履歴を取得する。"""
    url = "{}/v1/projects/{}/database/migrations".format(api_base.rstrip("/"), project_ref)
    payload = _request_json(url, token)
    if not isinstance(payload, list):
        raise DriftCheckError("Management APIの応答形式が想定と異なります（list以外）。")

    migrations = []
    for item in payload:
        if not isinstance(item, dict) or "version" not in item:
            raise DriftCheckError("Management APIの応答に version が無い要素があります。")
        migrations.append(item)
    return migrations


def fetch_remote_migration_detail(api_base: str, project_ref: str, token: str, version: str) -> dict:
    """Management APIから指定versionのmigration詳細（statements等）を取得する。"""
    url = "{}/v1/projects/{}/database/migrations/{}".format(api_base.rstrip("/"), project_ref, version)
    payload = _request_json(url, token)
    if not isinstance(payload, dict):
        raise DriftCheckError("Management APIのmigration詳細の応答形式が想定と異なります（dict以外）。")
    return payload


def normalize_sql(text: str) -> str:
    """SQL比較用の正規化（コメント行・空白・末尾セミコロンの差を吸収）。"""
    lines = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("--"):
            continue
        lines.append(stripped)
    return _WHITESPACE.sub(" ", " ".join(lines)).strip().rstrip(";").strip()


def compare_sql_content(remote_statements, local_text: str) -> str:
    """本番のstatementsとローカルファイル内容を比較する。match/differs/unavailable。"""
    if not isinstance(remote_statements, list) or not remote_statements:
        return "unavailable"
    remote = normalize_sql(";\n".join(str(statement) for statement in remote_statements))
    local = normalize_sql(local_text)
    if not remote or not local:
        return "unavailable"
    return "match" if remote == local else "differs"


def find_local_file_for_remote_name(
    name: str, local_versions: Dict[str, List[str]]
) -> Optional[Tuple[str, str]]:
    """本番のmigration nameに対応するローカルファイル (version, filename) を探す。"""
    if not name:
        return None
    target = name + ".sql"
    for version, filenames in local_versions.items():
        if not version:
            continue
        for filename in filenames:
            if filename == target or filename.endswith("_" + target):
                return version, filename
    return None


def compare_versions(
    local_versions: Dict[str, List[str]],
    remote_migrations: List[dict],
    local_only_allowlist: Optional[Dict[str, str]] = None,
) -> dict:
    """ローカルと本番のversion集合を比較し、ドリフト情報を返す。"""
    allowlist = local_only_allowlist or {}
    local_set: Set[str] = {version for version in local_versions if version}
    unparsable = list(local_versions.get("", []))
    duplicates = {
        version: names
        for version, names in local_versions.items()
        if version and len(names) > 1
    }
    remote_set = {str(item["version"]) for item in remote_migrations}

    remote_only = sorted(remote_set - local_set)
    local_only_all = sorted(local_set - remote_set)
    local_only_exceptions = [version for version in local_only_all if version in allowlist]
    local_only = [version for version in local_only_all if version not in allowlist]
    remote_names = {
        str(item["version"]): str(item.get("name") or "") for item in remote_migrations
    }

    return {
        "remote_only": remote_only,
        "remote_only_names": {version: remote_names.get(version, "") for version in remote_only},
        "remote_only_details": {},
        "local_only": local_only,
        "local_only_files": {version: local_versions[version] for version in local_only},
        "local_only_exceptions": local_only_exceptions,
        "local_only_exception_files": {
            version: local_versions[version] for version in local_only_exceptions
        },
        "local_only_exception_reasons": {
            version: allowlist.get(version, "") for version in local_only_exceptions
        },
        "duplicates": duplicates,
        "unparsable": unparsable,
        "local_count": len(local_set),
        "remote_count": len(remote_set),
    }


def enrich_remote_only_content(
    report: dict,
    api_base: str,
    project_ref: str,
    token: str,
    migrations_dir: str,
    local_versions: Dict[str, List[str]],
) -> dict:
    """remote_onlyの各versionについて同名ローカルファイルとの内容一致を確認しreportに追記する。"""
    details = {}
    for version in report["remote_only"]:
        name = report["remote_only_names"].get(version, "")
        entry = {"name": name, "local_file": None, "content": "unavailable", "note": ""}
        pair = find_local_file_for_remote_name(name, local_versions)
        if not pair:
            entry["note"] = "同名のローカルファイルが見つかりません"
            details[version] = entry
            continue
        _, local_filename = pair
        entry["local_file"] = local_filename
        try:
            detail = fetch_remote_migration_detail(api_base, project_ref, token, version)
        except DriftCheckError as exc:
            entry["note"] = str(exc)
        else:
            try:
                with open(os.path.join(migrations_dir, local_filename), encoding="utf-8") as handle:
                    local_text = handle.read()
            except OSError as exc:
                entry["note"] = "ローカルファイルを読めませんでした: {}".format(exc)
            else:
                entry["content"] = compare_sql_content(detail.get("statements"), local_text)
        details[version] = entry
    report["remote_only_details"] = details
    return report


def has_drift(report: dict) -> bool:
    return bool(
        report["remote_only"]
        or report["local_only"]
        or report["duplicates"]
        or report["unparsable"]
    )


def format_report(report: dict) -> str:
    """ドリフト検査結果を人間向けに整形する。"""
    exceptions = report.get("local_only_exceptions", [])
    lines = [
        "# migration drift check",
        "",
        "ローカル version: {} / 本番 version: {}".format(
            report["local_count"], report["remote_count"]
        ),
        "",
    ]
    if not has_drift(report):
        if exceptions:
            lines.append("結果: OK（意図的なローカル専用{}件を除く）".format(len(exceptions)))
        else:
            lines.append("結果: OK（ローカルと本番のmigration履歴は一致）")
    else:
        lines.append("結果: DRIFT DETECTED")
    lines.append("")

    if report["remote_only"]:
        lines.append("## 本番のみに存在（ローカルにファイルが無い = Dashboard等からの直接適用の疑い）")
        details = report.get("remote_only_details", {})
        for version in report["remote_only"]:
            name = report["remote_only_names"].get(version, "")
            lines.append("- {} {}".format(version, name).rstrip())
            entry = details.get(version)
            if not entry:
                continue
            if entry["content"] == "match":
                lines.append(
                    "  - ローカル対応: {} / 内容: match（filenameを本番version `{}` に合わせると整合）".format(
                        entry["local_file"], version
                    )
                )
            elif entry["content"] == "differs":
                lines.append(
                    "  - ローカル対応: {} / 内容: **differs**（本番適用内容とローカルファイルが不一致。直接のrename不可）".format(
                        entry["local_file"]
                    )
                )
            else:
                note = entry.get("note") or "本番側のstatementsが取得できません"
                lines.append("  - 内容確認: unavailable（{}）".format(note))
        lines.append("")

    if report["local_only"]:
        lines.append("## ローカルのみに存在（本番未適用）")
        for version in report["local_only"]:
            for filename in report["local_only_files"].get(version, []):
                lines.append("- {} ({})".format(version, filename))
        lines.append("")

    if exceptions:
        lines.append("## 意図的なローカル専用（既知例外: local-only-migrations.txt）")
        for version in exceptions:
            for filename in report["local_only_exception_files"].get(version, []):
                reason = report["local_only_exception_reasons"].get(version, "")
                lines.append("- {} ({}) — {}".format(version, filename, reason).rstrip(" —"))
        lines.append("")

    if report["duplicates"]:
        lines.append("## version重複（ローカルファイル）")
        for version, names in sorted(report["duplicates"].items()):
            lines.append("- {}: {}".format(version, ", ".join(names)))
        lines.append("")

    if report["unparsable"]:
        lines.append("## versionを解釈できないファイル")
        for name in report["unparsable"]:
            lines.append("- {}".format(name))
        lines.append("")

    if has_drift(report):
        lines.append("対応方針: remote_only -> ローカルファイル化 or filenameの本番version合わせ（内容matchの確認後） / local_only -> 本番適用の要否を確認")
    return "\n".join(lines).rstrip("\n") + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="本番Supabaseのmigration履歴とローカルファイルのドリフトを検知する（読み取り専用）"
    )
    parser.add_argument(
        "--project-ref",
        default=os.environ.get(ENV_PROJECT_REF),
        help="Supabase project ref（未指定時は環境変数 {} ）".format(ENV_PROJECT_REF),
    )
    parser.add_argument(
        "--local-dir",
        default=DEFAULT_LOCAL_DIR,
        help="ローカルmigrationディレクトリ（既定: {}）".format(DEFAULT_LOCAL_DIR),
    )
    parser.add_argument(
        "--local-only-file",
        default=DEFAULT_LOCAL_ONLY_FILE,
        help="意図的なローカル専用migrationの一覧（既定: {}）".format(DEFAULT_LOCAL_ONLY_FILE),
    )
    parser.add_argument(
        "--api-base",
        default=DEFAULT_API_BASE,
        help="Management APIのベースURL（既定: {}）".format(DEFAULT_API_BASE),
    )
    parser.add_argument(
        "--token",
        default=os.environ.get(ENV_TOKEN),
        help="Supabaseアクセストークン（未指定時は環境変数 {} ）".format(ENV_TOKEN),
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.token:
        print(
            "エラー: Supabaseアクセストークンがありません。--token か環境変数 {} を設定してください。".format(
                ENV_TOKEN
            ),
            file=sys.stderr,
        )
        return 2
    if not args.project_ref:
        print(
            "エラー: project ref がありません。--project-ref か環境変数 {} を設定してください。".format(
                ENV_PROJECT_REF
            ),
            file=sys.stderr,
        )
        return 2
    if not os.path.isdir(args.local_dir):
        print("エラー: ローカルmigrationディレクトリが見つかりません: {}".format(args.local_dir), file=sys.stderr)
        return 2

    local_versions = collect_local_versions(args.local_dir)
    allowlist = load_local_only_allowlist(args.local_only_file)
    try:
        remote_migrations = fetch_remote_migrations(args.api_base, args.project_ref, args.token)
    except DriftCheckError as exc:
        print("エラー: {}".format(exc), file=sys.stderr)
        return 2

    report = compare_versions(local_versions, remote_migrations, allowlist)
    if report["remote_only"]:
        report = enrich_remote_only_content(
            report, args.api_base, args.project_ref, args.token, args.local_dir, local_versions
        )
    print(format_report(report), end="")

    return 1 if has_drift(report) else 0


if __name__ == "__main__":
    sys.exit(main())
