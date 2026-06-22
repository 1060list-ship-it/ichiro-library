#!/bin/bash
# transcript_failed 12件をローカル Whisper で処理するバッチスクリプト
# caffeinate でスリープを防止しながら実行する
#
# 使い方: bash run_local_whisper_batch.sh
#         bash run_local_whisper_batch.sh --dry-run

set -euo pipefail
cd "$(dirname "$0")"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "[DRY RUN モード]"
fi

PYTHON=".venv/bin/python"
SCRIPT="whisper_transcribe.py"

# グッズ紹介(1分)は除外済み
VIDEO_IDS=(
  "xL7tBuMf6sI"  # 初めまして。こんばんわ。(87分) 2022-12-08
  "Ky9w1Ya9-zI"  # まだ眠れないの。プレイグテイル(126分) 2022-12-25
  "7O8rwB3ljv8"  # 足がムズムズその3(32分) 2023-02-25
  "Qkcz0wYLT9k"  # アイスコーヒー(62分) 2023-02-25
  "yivnOLo2HtU"  # 老いて尚、カップヌードル。(103分) 2023-03-16
  "Tv01SFtRwAA"  # 老いて尚、カップヌードルその2(28分) 2023-03-18
  "xxNmzltiOPU"  # 偽りの黒真珠その4(137分) 2023-04-01
  "p74QXy1k0qU"  # THE LAST OF US 2 その2(157分) 2023-05-30
  "THMWaRksofk"  # THE LAST OF US 2 その5(175分) 2023-06-05
  "LSS4Ja3rXkk"  # THE LAST OF US 2 その8(170分) 2023-06-08
  "N5Bawmg499g"  # THE LAST OF US 2 その9(194分) 2023-06-09
  "wi29x_SqJBc"  # THE LAST OF US 2 その10(101分) 2023-06-13
)

TOTAL=${#VIDEO_IDS[@]}
echo "処理対象: ${TOTAL}件（スリープ防止: caffeinate 使用）"
echo "開始: $(date)"

for i in "${!VIDEO_IDS[@]}"; do
  VID="${VIDEO_IDS[$i]}"
  NUM=$((i + 1))
  echo ""
  echo "=== ${NUM}/${TOTAL}: ${VID} ($(date)) ==="
  caffeinate -i "$PYTHON" "$SCRIPT" --video "$VID" --local --no-summarize $DRY_RUN
  echo "完了: ${VID}"
done

echo ""
echo "=== 全件完了: $(date) ==="
