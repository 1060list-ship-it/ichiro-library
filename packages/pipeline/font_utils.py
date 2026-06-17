"""
日本語フォントのダウンロード・キャッシュ。
GitHub Actions / macOS / Linux で同一コードで動作する。
"""
import urllib.request
from pathlib import Path

_FONTS_DIR = Path(__file__).parent / "fonts"

# Noto Sans JP（可変フォント）
_NOTO_JP_PATH = _FONTS_DIR / "NotoSansJP.ttf"
_NOTO_JP_URL = (
    "https://github.com/google/fonts/raw/main/ofl/notosansjp/"
    "NotoSansJP%5Bwght%5D.ttf"
)

# Zen Kaku Gothic Antique Bold（w番号・日付用）
_ZEN_KAKU_BOLD_PATH = _FONTS_DIR / "ZenKakuGothicAntique-Bold.ttf"
_ZEN_KAKU_BOLD_URL = (
    "https://github.com/google/fonts/raw/main/ofl/zenkakugothicantique/"
    "ZenKakuGothicAntique-Bold.ttf"
)

# Zen Antique Regular（見出し用）
_ZEN_ANTIQUE_PATH = _FONTS_DIR / "ZenAntique-Regular.ttf"
_ZEN_ANTIQUE_URL = (
    "https://github.com/google/fonts/raw/main/ofl/zenantique/"
    "ZenAntique-Regular.ttf"
)


def _fetch(url: str, path: Path) -> Path:
    if not path.exists():
        _FONTS_DIR.mkdir(exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def get_font_path() -> Path:
    """NotoSansJP フォントパスを返す（後方互換）。"""
    return _fetch(_NOTO_JP_URL, _NOTO_JP_PATH)


def get_zen_kaku_bold_path() -> Path:
    """Zen Kaku Gothic Antique Bold フォントパスを返す。"""
    return _fetch(_ZEN_KAKU_BOLD_URL, _ZEN_KAKU_BOLD_PATH)


def get_zen_antique_path() -> Path:
    """Zen Antique Regular フォントパスを返す。"""
    return _fetch(_ZEN_ANTIQUE_URL, _ZEN_ANTIQUE_PATH)
