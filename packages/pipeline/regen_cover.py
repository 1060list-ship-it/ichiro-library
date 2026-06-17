"""
既存マガジンのカバー画像だけ再生成するワンショットスクリプト。
使い方: python regen_cover.py 2026-W22 2026-W23
"""
import sys
import os
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

from google import genai
from supabase import create_client

from weekly_magazine import generate_cover_image, week_label, get_week_range


def main():
    labels = sys.argv[1:] or ["2026-W22", "2026-W23"]

    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    for label in labels:
        print(f"\n=== {label} ===")

        # 既存マガジンを取得（headline 等は content JSONB の中）
        res = sb.table("magazines").select(
            "week_label, content"
        ).eq("week_label", label).execute()

        if not res.data:
            print(f"  [{label}] マガジンが見つかりません。スキップ。")
            continue

        mag = res.data[0]
        content = mag.get("content") or {}
        print(f"  headline: {content['headline'][:60]}")

        # week_label から monday/sunday を復元
        # label 形式: "2026-W22"
        year = int(label[:4])
        week = int(label[-2:])
        # その年の第1月曜日を求めてweek番号分オフセット
        jan1 = date(year, 1, 1)
        # jan1 の曜日（0=月）
        first_monday = jan1 + timedelta(days=(7 - jan1.weekday()) % 7)
        monday = first_monday + timedelta(weeks=week - 1)
        sunday = monday + timedelta(days=6)
        print(f"  期間: {monday} 〜 {sunday}")

        url = generate_cover_image(client, content, label, sb, monday, sunday)
        if url:
            print(f"  完了: {url}")
        else:
            print(f"  失敗: generate_cover_image が None を返しました")


if __name__ == "__main__":
    main()
