"""
Gemini要約のスタンドアロンテスト
youtube-transcript-api不要、サンプルテキストで動作確認
"""
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from summarize import get_gemini_client, summarize
import json

SAMPLE = """
[00:00:00] こんばんは山口一郎です
[00:00:05] 今夜もやってまいりました今夜も雑談中
[00:00:15] えーと今日はですね先日オールナイトニッポンに出演しまして
[00:01:00] 本当に楽しかったですね久しぶりにラジオに出て
[00:05:00] ここで少し音楽の話をしたいと思います
[00:05:30] 新しいアルバムの制作が進んでいます
[00:10:00] サカナクションとして新しい挑戦をしていきたい
[00:15:00] リスナーの皆さんからの質問コーナーです
[00:15:30] 質問：山口さんが最近ハマっていることは何ですか
[00:16:00] 最近はですね料理にはまっています
[00:20:00] 今夜のゲストを紹介します田中太郎さんです
[00:20:30] 田中さんは音楽プロデューサーとして活躍されています
[00:30:00] 未知との遭遇コーナーです
[00:30:30] 今日は新しい音楽を紹介します
[00:45:00] それではまた来週お会いしましょう
"""

print("Gemini接続テスト中...")
model = get_gemini_client()
result = summarize(SAMPLE, model=model)

if result:
    print("\n✅ 成功！")
    print(json.dumps(result, ensure_ascii=False, indent=2))
else:
    print("\n❌ 失敗")
