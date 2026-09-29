"""validate_summary_dates のユニットテスト（Gemini API 不要）。

2026-09-29 の全319件横断チェックで検出した実誤り7件を回帰ケースとして含む。
"""
from summarize import validate_summary_dates


# --- 実誤り7件（旧文は検出すること） ---
OLD_NEW = [
    (
        "2025-05-28",
        "2月28日の配信は、山口一郎が「怪獣」のYouTube1億回再生達成という喜ばしい報告から幕を開けました。",
        "5月28日の配信は、山口一郎が「怪獣」のYouTube1億回再生達成という喜ばしい報告から幕を開けました。",
    ),
    (
        "2025-08-09",
        "2024年8月10日深夜、山口一郎は「SAKANAQUARIUM 光 ONLINE」のライブ映像を視聴しながら、その裏側と制作秘話を深く掘り下げた解説ライブを配信しました。",
        "2025年8月10日深夜、山口一郎は「SAKANAQUARIUM 光 ONLINE」のライブ映像を視聴しながら、その裏側と制作秘話を深く掘り下げた解説ライブを配信しました。",
    ),
    (
        "2025-08-15",
        "2024年8月15日金曜日21時35分に始まったこのライブ配信で、山口一郎は冒頭で自身の祖父の戦争体験に触れました。",
        "2025年8月15日金曜日21時35分に始まったこのライブ配信で、山口一郎は冒頭で自身の祖父の戦争体験に触れました。",
    ),
    (
        "2026-01-01",
        "2024年1月2日深夜に配信されたこのライブは、山口一郎が二つのゲームを実況する形で進行しました。",
        "2026年1月2日深夜に配信されたこのライブは、山口一郎が二つのゲームを実況する形で進行しました。",
    ),
    (
        "2026-01-03",
        "2024年1月4日の深夜に配信された山口一郎のYouTubeライブは、サバイバルホラーゲームの実況が中心となった。",
        "2026年1月4日の深夜に配信された山口一郎のYouTubeライブは、サバイバルホラーゲームの実況が中心となった。",
    ),
    (
        "2026-01-04",
        "2024年1月4日、日曜日の22時からスタートしたこの夜の配信は、山口一郎によるホラーゲームの続きがメインコンテンツでした。",
        "2026年1月4日、日曜日の22時からスタートしたこの夜の配信は、山口一郎によるホラーゲームの続きがメインコンテンツでした。",
    ),
    (
        "2026-05-05",
        "2024年5月5日、山口一郎がゴールデンウィーク中の夜に配信を行った。",
        "2026年5月5日、山口一郎がゴールデンウィーク中の夜に配信を行った。",
    ),
]


def test_detects_all_seven_real_errors():
    for stream_date, old, _new in OLD_NEW:
        assert validate_summary_dates(old, stream_date) != [], stream_date


def test_fixed_texts_pass():
    for stream_date, _old, new in OLD_NEW:
        assert validate_summary_dates(new, stream_date) == [], stream_date


# --- 誤検知ガード ---
def test_future_announcement_is_not_flagged():
    s = "3月12日の山口一郎YouTubeライブ配信は、3日連続の配信として、まず3月16日午前0時10分に解禁される新曲「怪獣」ミュージックビデオ（MV）のプロモーションを中心に進行しました。"
    assert validate_summary_dates(s, "2025-03-12") == []


def test_next_year_reference_is_not_flagged():
    s = "紅白歌合戦出演から間もない2026年元旦深夜、山口一郎はレコーディングエンジニアの浦本雅史と共にYouTubeライブ配信を行った。"
    assert validate_summary_dates(s, "2025-12-31") == []


def test_fiscal_year_is_not_flagged():
    s = "山口一郎は2025年度ラジコで1位を獲得した「怪獣」が3億再生を突破したことに触れつつ、音楽業界の現状を明かしました。"
    assert validate_summary_dates(s, "2026-04-29") == []


def test_post_midnight_start_within_tolerance():
    # stream_date=1/2・タイトル1/3の日跨ぎ配信。タイトルと一致する1/3は許容する
    s = "1月3日の深夜に始まった山口一郎のYouTubeライブ配信は、彼がホラーゲームをプレイするゲーム実況が中心となりました。"
    assert validate_summary_dates(s, "2026-01-02") == []


def test_invalid_and_empty_inputs():
    assert validate_summary_dates("2月28日の配信は。", None) == []
    assert validate_summary_dates("2月28日の配信は。", "not-a-date") == []
    assert validate_summary_dates("", "2025-05-28") == []
    # 存在しない日付は無視する（2026-13-01）
    assert validate_summary_dates("2026年13月1日の配信は。", "2026-01-01") == []
