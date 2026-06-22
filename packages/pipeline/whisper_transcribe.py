"""
Whisper 文字起こしモジュール — transcript_failed の最終フォールバック

フロー:
  1. yt-dlp で YouTube から音声をダウンロード（m4a/mp3）
  2. OpenAI Whisper API または mlx_whisper で文字起こし（ja）
  3. transcript を Supabase に保存し、必要なら AI 要約まで実行して status を public に更新

前提:
  - OpenAI API 利用時は OPENAI_API_KEY が .env.local に設定済みであること
  - ローカル処理時は mlx_whisper が利用可能であること
  - yt-dlp が requirements.txt に含まれていること
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_MAX_AUDIO_SIZE_MB = 24  # Whisper API の上限は 25MB


def transcribe_video(video_id: str) -> tuple[str, list[dict]]:
    """
    YouTube 動画を音声ダウンロード → Whisper API で文字起こし。
    戻り値: (full_text, snippets)
    """
    from openai import OpenAI

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY が未設定です")

    client = OpenAI(api_key=api_key)
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = _download_audio(url, tmpdir)
        logger.info(f"[{video_id}] 音声ダウンロード完了: {audio_path}")

        size_mb = Path(audio_path).stat().st_size / (1024 * 1024)
        if size_mb > _MAX_AUDIO_SIZE_MB:
            raise ValueError(f"音声ファイルが {size_mb:.1f}MB で Whisper API 上限（25MB）を超えています")

        logger.info(f"[{video_id}] Whisper API 送信中 ({size_mb:.1f}MB)...")
        with open(audio_path, "rb") as f:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="ja",
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

    segments = getattr(response, "segments", []) or []
    snippets = [
        {
            "text": seg.get("text", "").strip(),
            "start": seg.get("start", 0.0),
            "duration": seg.get("end", 0.0) - seg.get("start", 0.0),
        }
        for seg in segments
        if seg.get("text", "").strip()
    ]
    full_text = " ".join(s["text"] for s in snippets)

    logger.info(f"[{video_id}] Whisper 文字起こし完了: {len(snippets)} segments")
    return full_text, snippets


def transcribe_video_local(
    video_id: str,
    model_name: str = "mlx-community/whisper-large-v3-turbo",
) -> tuple[str, list[dict]]:
    """
    mlx_whisper でローカル文字起こし。Apple Silicon 専用・無料・サイズ制限なし。
    戻り値: (full_text, snippets)
    """
    import mlx_whisper

    url = f"https://www.youtube.com/watch?v={video_id}"
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = _download_audio(url, tmpdir)
        logger.info(f"[{video_id}] ローカル Whisper 開始: {audio_path}")

        result = mlx_whisper.transcribe(
            audio_path,
            path_or_hf_repo=model_name,
            language="ja",
            word_timestamps=False,
        )

    segments = result.get("segments") or []
    snippets = [
        {
            "text": seg.get("text", "").strip(),
            "start": seg.get("start", 0.0),
            "duration": seg.get("end", 0.0) - seg.get("start", 0.0),
        }
        for seg in segments
        if seg.get("text", "").strip()
    ]
    full_text = " ".join(s["text"] for s in snippets)

    logger.info(f"[{video_id}] ローカル Whisper 完了: {len(snippets)} segments")
    return full_text, snippets


def _download_audio(url: str, output_dir: str) -> str:
    """yt-dlp で音声のみをダウンロードして、ファイルパスを返す"""
    output_template = str(Path(output_dir) / "audio.%(ext)s")

    cmd = [
        "yt-dlp",
        "--format", "bestaudio[ext=m4a]/bestaudio/best",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",          # 中品質（ファイルサイズ優先）
        "--no-playlist",
        "--output", output_template,
        "--quiet",
        url,
    ]

    cookies_path = _find_cookies_path()
    if cookies_path:
        cmd += ["--cookies", cookies_path]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp 失敗: {result.stderr}")

    # ダウンロードされたファイルを探す
    for ext in ("mp3", "m4a", "webm", "opus"):
        candidate = Path(output_dir) / f"audio.{ext}"
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(f"ダウンロード後の音声ファイルが見つかりません: {output_dir}")


def _find_cookies_path() -> Optional[str]:
    env_path = os.getenv("YOUTUBE_COOKIES_PATH")
    if env_path and Path(env_path).exists():
        return env_path
    candidates = [
        Path(__file__).parent.parent.parent / "www.youtube.com_cookies.txt",
        Path(__file__).parent / "www.youtube.com_cookies.txt",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return None


def transcribe_and_store(
    supabase_client,
    video_id: str,
    dry_run: bool = False,
    local: bool = False,
    no_summarize: bool = False,
) -> None:
    """
    Whisper で文字起こしして Supabase を更新し、AI 要約まで実行する。
    worker.py の whisper_transcribe ジョブから呼び出される。
    """
    mode = "local" if local else "api"
    if dry_run:
        logger.info(
            "[DRY RUN] %s whisper_transcribe をスキップ: mode=%s no_summarize=%s",
            video_id,
            mode,
            no_summarize,
        )
        return

    from fetch_new_videos import _fetch_video_details, get_youtube_client

    if local:
        full_text, snippets = transcribe_video_local(video_id)
    else:
        full_text, snippets = transcribe_video(video_id)

    if no_summarize:
        from store import update_transcript

        update_transcript(supabase_client, video_id, full_text, source="whisper")
        logger.info(f"[{video_id}] transcript のみ保存（--no-summarize）")
        return

    # video_meta を YouTube API から再取得して process_video に渡す
    youtube = get_youtube_client()
    details = _fetch_video_details(youtube, [video_id])
    if not details:
        raise ValueError(f"YouTube API から動画情報を取得できません: {video_id}")

    video_meta = details[0]
    from summarize import get_gemini_client

    gemini = get_gemini_client()

    # transcript 取得済みとして TranscriptResult を組み立てて再利用
    from get_transcript import build_timestamped_text
    from summarize import summarize
    from store import upsert_stream, insert_chapters, save_transcript_snapshot

    timestamped_text = build_timestamped_text(snippets)
    ai_result = summarize(timestamped_text, model=gemini)

    stream_id, is_review_locked = upsert_stream(
        client=supabase_client,
        video_meta=video_meta,
        transcript_text=full_text,
        transcript_source="whisper",
        ai_result=ai_result,
    )

    snapshot_id = None
    if snippets:
        try:
            snapshot_id = save_transcript_snapshot(supabase_client, stream_id, "whisper", snippets)
        except Exception as e:
            logger.warning(f"[{video_id}] snapshot 保存失敗: {e}")

    if not is_review_locked and ai_result and ai_result.get("chapters"):
        insert_chapters(supabase_client, stream_id, ai_result["chapters"], snapshot_id=snapshot_id)

    logger.info(f"[{video_id}] whisper_transcribe 完了: stream_id={stream_id}")


if __name__ == "__main__":
    import argparse
    from dotenv import load_dotenv
    from store import get_supabase_client

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

    parser = argparse.ArgumentParser(description="Whisper 文字起こし")
    parser.add_argument("--video", required=True, help="YouTube 動画 ID")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--local", action="store_true", help="mlx_whisper でローカル処理（OpenAI API 不使用）")
    parser.add_argument("--no-summarize", action="store_true", help="Gemini 要約をスキップして transcript のみ保存")
    args = parser.parse_args()

    client = get_supabase_client()
    transcribe_and_store(
        client,
        args.video,
        dry_run=args.dry_run,
        local=args.local,
        no_summarize=args.no_summarize,
    )
