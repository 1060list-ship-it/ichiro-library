#!/usr/bin/env python3
"""ローカルmigrationファイルと本番Supabaseのmigration履歴のドリフトを検知する（読み取り専用）。

Supabase Management API の GET /v1/projects/{ref}/database/migrations を呼び、
本番 schema_migrations に記録された version と `supabase/migrations/*.sql` の
filename prefix を突合する。

- remote_only: 本番にあるがローカルに無い version（Dashboard/SQLエディタからの直接適用など）
- local_only : ローカルにあるが本番に適用されていない version
- duplicate  : 同一 version prefix を持つローカルファイルが複数ある状態

このスクリプトは本番DBへ接続しない・書き込まない（read-only）。
アクセストークンの値は出力しない。

終了コード:
  0: ドリフトなし
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
from typing import Dict, List, Optional, Set

DEFAULT_API_BASE = "https://api.supabase.com"
DEFAULT_LOCAL_DIR = "supabase/migrations"
ENV_TOKEN = "SUPABASE_ACCESS_TOKEN"
ENV_PROJECT_REF = "SUPABASE_PROJECT_REF"

_VERSION_PREFIX = re.compile(r"^(\d+)")
_TIMEOUT_SECONDS = 30


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


def fetch_remote_migrations(api_base: str, project_ref: str, token: str) -> List[dict]:
    """Management APIから本番の適用済みmigration履歴を取得する。"""
    url = "{}/v1/projects/{}/database/migrations".format(
        api_base.rstrip("/"), project_ref
    )
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
            payload = json.loads(response.read().decode("utf-8"))
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

    if not isinstance(payload, list):
        raise DriftCheckError("Management APIの応答形式が想定と異なります（list以外）。")

    migrations = []
    for item in payload:
        if not isinstance(item, dict) or "version" not in item:
            raise DriftCheckError("Management APIの応答に version が無い要素があります。")
        migrations.append(item)
    return migrations


def compare_versions(
    local_versions: Dict[str, List[str]], remote_migrations: List[dict]
) -> dict:
    """ローカルと本番の version 集合を比較し、ドリフト情報を返す。"""
    local_set: Set[str] = {version for version in local_versions if version}
    unparsable = list(local_versions.get("", []))
    duplicates = {
        version: names
        for version, names in local_versions.items()
        if version and len(names) > 1
    }
    remote_set = {str(item["version"]) for item in remote_migrations}

    remote_only = sorted(remote_set - local_set)
    local_only = sorted(local_set - remote_set)
    remote_names = {
        str(item["version"]): str(item.get("name") or "") for item in remote_migrations
    }

    return {
        "remote_only": remote_only,
        "remote_only_names": {version: remote_names.get(version, "") for version in remote_only},
        "local_only": local_only,
        "local_only_files": {version: local_versions[version] for version in local_only},
        "duplicates": duplicates,
        "unparsable": unparsable,
        "local_count": len(local_set),
        "remote_count": len(remote_set),
    }


def format_report(report: dict) -> str:
    """ドリフト検査結果を人間向けに整形する。"""
    has_drift = bool(
        report["remote_only"]
        or report["local_only"]
        or report["duplicates"]
        or report["unparsable"]
    )
    lines = [
        "# migration drift check",
        "",
        "ローカル version: {} / 本番 version: {}".format(
            report["local_count"], report["remote_count"]
        ),
        "",
    ]
    if not has_drift:
        lines.append("結果: OK（ローカルと本番のmigration履歴は一致）")
        return "\n".join(lines) + "\n"

    lines.append("結果: DRIFT DETECTED")
    lines.append("")
    if report["remote_only"]:
        lines.append("## 本番のみに存在（ローカルにファイルが無い = Dashboard等からの直接適用の疑い）")
        for version in report["remote_only"]:
            name = report["remote_only_names"].get(version, "")
            lines.append("- {} {}".format(version, name).rstrip())
        lines.append("")
    if report["local_only"]:
        lines.append("## ローカルのみに存在（本番未適用）")
        for version in report["local_only"]:
            for filename in report["local_only_files"].get(version, []):
                lines.append("- {} ({})".format(version, filename))
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
    lines.append("対応方針: remote_only -> ローカルファイル化 or 履歴の扱いを一幾判断 / local_only -> 本番適用の要否を確認")
    return "\n".join(lines) + "\n"


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
    try:
        remote_migrations = fetch_remote_migrations(args.api_base, args.project_ref, args.token)
    except DriftCheckError as exc:
        print("エラー: {}".format(exc), file=sys.stderr)
        return 2

    report = compare_versions(local_versions, remote_migrations)
    print(format_report(report), end="")

    if report["remote_only"] or report["local_only"] or report["duplicates"] or report["unparsable"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
