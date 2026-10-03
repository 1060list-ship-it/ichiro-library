"""
_make_cover の出力サイズ検証（タスク②: CSS aspect-[210/297] 統一）。

API・DB・ネットワークを使わず、ダミー画像で _make_cover のみ実行する。
"""

from io import BytesIO

from PIL import Image

import weekly_magazine


def _dummy_image_bytes(w: int, h: int, color: tuple[int, int, int]) -> bytes:
    img = Image.new("RGB", (w, h), color)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_make_cover_output_is_210_297():
    """gpt-image-2 の出力想定 (1024x1536) から 1024x1448 (≒210:297) になること。"""
    for color in [(20, 20, 30), (235, 230, 220)]:  # 暗・明＝白黒テキスト両分岐
        out = weekly_magazine._make_cover(_dummy_image_bytes(1024, 1536, color), "w99", "2026/01/01 – 01/07")
        img = Image.open(BytesIO(out))
        assert img.size == (1024, 1448), img.size
        ratio = img.size[0] / img.size[1]
        assert abs(ratio - 210 / 297) < 1e-3, ratio
