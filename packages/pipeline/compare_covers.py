"""
表紙画像 モデル比較テスト
Gemini 3.1 Flash Image / gpt-image-2 を同一プロンプトで生成して保存する。

使い方:
  cd packages/pipeline
  python compare_covers.py
"""

import os
import base64
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

from weekly_magazine import COVER_PROMPT_TEMPLATE, _sanitize_cover_prompt

load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

# ── サンプルコンテンツ（固定ダミー） ──────────────────────────────────────
SAMPLE = {
    "headline": "深夜の水族館、光と音の旅",
    "topics": "水族館コラボ配信, 新曲制作の裏話, ファンへのメッセージ",
    "songs": "忘れられないの, 夜の踊り子, ミュージック",
    "mood": "emotional and moving",
}

# ── ステップ1: Gemini でカバープロンプトを生成 ─────────────────────────────
def build_image_prompt(gemini_key: str) -> str:
    from google import genai
    client = genai.Client(api_key=gemini_key)
    meta_prompt = COVER_PROMPT_TEMPLATE.format(**SAMPLE)
    res = client.models.generate_content(model="gemini-2.5-flash", contents=meta_prompt)
    return _sanitize_cover_prompt(res.text, label="compare")


# ── ステップ2: 各モデルで生成 ─────────────────────────────────────────────

def gen_gemini_flash_image(prompt: str, gemini_key: str) -> bytes:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=gemini_key)
    res = client.models.generate_content(
        model="gemini-3.1-flash-image",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="3:4"),
        ),
    )
    for part in res.candidates[0].content.parts:
        if part.inline_data is not None:
            return part.inline_data.data
    raise ValueError("画像が生成されませんでした")


def gen_gpt_image2(prompt: str, openai_key: str) -> bytes:
    from openai import OpenAI
    client = OpenAI(api_key=openai_key)
    res = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1024x1536",
        quality="high",
        n=1,
    )
    return base64.b64decode(res.data[0].b64_json)


# ── メイン ────────────────────────────────────────────────────────────────

def main():
    gemini_key = os.environ.get("GEMINI_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    if not gemini_key:
        print("ERROR: GEMINI_API_KEY が未設定")
        return
    if not openai_key:
        print("ERROR: OPENAI_API_KEY が未設定")
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(__file__).parent / "compare_output"
    out_dir.mkdir(exist_ok=True)

    print("▶ カバープロンプト生成中（Gemini 2.5 Flash）...")
    image_prompt = build_image_prompt(gemini_key)
    prompt_file = out_dir / f"{ts}_prompt.txt"
    prompt_file.write_text(image_prompt, encoding="utf-8")
    print(f"  プロンプト:\n  {image_prompt[:120]}...\n")

    models = [
        ("gemini_flash_image", lambda: gen_gemini_flash_image(image_prompt, gemini_key)),
        ("gpt_image2",         lambda: gen_gpt_image2(image_prompt, openai_key)),
    ]

    results = []
    for name, fn in models:
        print(f"▶ 生成中: {name} ...")
        try:
            data = fn()
            path = out_dir / f"{ts}_{name}.png"
            path.write_bytes(data)
            print(f"  ✓ 保存: {path.name}  ({len(data) // 1024} KB)")
            results.append((name, str(path), None))
        except Exception as e:
            print(f"  ✗ エラー: {e}")
            results.append((name, None, str(e)))

    print(f"\n── 結果 ──────────────────────────────")
    for name, path, err in results:
        if path:
            print(f"  {name}: {path}")
        else:
            print(f"  {name}: 失敗 → {err}")
    print(f"\n出力先: {out_dir}/")
    print("Finder で開く: open " + str(out_dir))


if __name__ == "__main__":
    main()
