"""
summarize.py の 429 分類ロジック（月間上限 / 分間制限 / 日次 / 不明）の純粋関数テスト。

Supabase・Gemini 実通信は一切発生しない。
"""

from conftest import make_api_error

import summarize


def test_monthly_spend_cap_is_resource_exhausted_but_not_retryable():
    error = make_api_error("Quota exceeded. Please check the monthly spend cap for your project.")
    assert summarize.is_gemini_resource_exhausted(error) is True
    assert summarize.gemini_resource_exhaustion_kind(error) == "monthly_spend_cap"
    assert summarize.should_retry_gemini_exception(error) is False


def test_next_billing_cycle_wording_is_monthly_spend_cap():
    error = make_api_error("You have exhausted your prepay credit balance. Retry at the start of the next billing cycle.")
    assert summarize.gemini_resource_exhaustion_kind(error) == "monthly_spend_cap"
    assert summarize.should_retry_gemini_exception(error) is False


def test_per_minute_rate_limit_is_retryable():
    error = make_api_error("Quota exceeded for quota metric 'Requests' limit 'Requests per minute (RPM)'.")
    assert summarize.is_gemini_resource_exhausted(error) is True
    assert summarize.gemini_resource_exhaustion_kind(error) == "per_minute_rate_limit"
    assert summarize.should_retry_gemini_exception(error) is True


def test_tpm_wording_is_per_minute_rate_limit():
    error = make_api_error("Resource has been exhausted: TokensPerMinute limit reached.")
    assert summarize.gemini_resource_exhaustion_kind(error) == "per_minute_rate_limit"
    assert summarize.should_retry_gemini_exception(error) is True


def test_per_day_quota_is_non_retryable_quota():
    error = make_api_error("Requests per day (RPD) limit exceeded for this project.")
    assert summarize.gemini_resource_exhaustion_kind(error) == "non_retryable_quota"
    assert summarize.should_retry_gemini_exception(error) is False


def test_unknown_429_wording_defaults_to_unknown_and_is_not_retried():
    error = make_api_error("RESOURCE_EXHAUSTED with no further detail provided by the API.")
    assert summarize.is_gemini_resource_exhausted(error) is True
    assert summarize.gemini_resource_exhaustion_kind(error) == "unknown_resource_exhausted"
    # kanaのAMENDMENT S7: 区別できない429は安全側に倒して即中断（リトライしない）
    assert summarize.should_retry_gemini_exception(error) is False


def test_non_429_api_error_is_always_retried():
    error = make_api_error("internal error", code=500, status="INTERNAL")
    assert summarize.is_gemini_resource_exhausted(error) is False
    assert summarize.gemini_resource_exhaustion_kind(error) == "not_resource_exhausted"
    assert summarize.should_retry_gemini_exception(error) is True


def test_non_api_error_exception_is_always_retried():
    # APIError以外の例外（ネットワーク断など）は型で判定できないため常にリトライ対象
    assert summarize.should_retry_gemini_exception(ValueError("boom")) is True


def test_monthly_and_per_minute_wording_both_present_prefers_monthly():
    # 月間上限のメッセージにたまたま「per minute」を含むレート表記が混在しても、
    # 月間上限判定が優先され安全側（即中断）に倒れることを確認する。
    error = make_api_error(
        "Your requests per minute quota is fine, but the monthly spend cap has been reached."
    )
    assert summarize.gemini_resource_exhaustion_kind(error) == "monthly_spend_cap"
    assert summarize.should_retry_gemini_exception(error) is False
