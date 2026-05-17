#!/usr/bin/env bash
# Codex非対話実行スクリプト
# 使い方:
#   ./scripts/codex-run.sh                         # docs/brief.md を使う
#   ./scripts/codex-run.sh docs/phase4-brief.md    # briefファイルを指定
#   ./scripts/codex-run.sh docs/brief.md gpt-5.5   # モデルも指定

set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRIEF="${1:-docs/brief.md}"
MODEL="${2:-gpt-5.4}"
LOG_FILE="/tmp/codex-$(date +%Y%m%d-%H%M%S).log"

BRIEF_PATH="$PROJ_DIR/$BRIEF"
[[ -f "$BRIEF_PATH" ]] || { echo "briefが見つかりません: $BRIEF_PATH"; exit 1; }

echo "▶ Codex exec"
echo "  brief : $BRIEF"
echo "  model : $MODEL"
echo "  log   : $LOG_FILE"
echo ""

codex exec \
  --full-auto \
  --no-alt-screen \
  -m "$MODEL" \
  -C "$PROJ_DIR" \
  "$(cat "$BRIEF_PATH")" 2>&1 | tee "$LOG_FILE"

echo ""
echo "──────────────────────────────"
echo "変更ファイル:"
git -C "$PROJ_DIR" diff --stat HEAD
echo ""
echo "Claude Codeで「確認して」と伝えてください"
