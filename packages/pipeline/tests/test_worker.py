"""worker.main() のジョブ完了・失敗経路を検証する。"""

from unittest.mock import Mock

import worker


JOB = {"id": "job-1", "kind": "reprocess"}


def _setup_worker(monkeypatch, fake_supabase):
    run_job = Mock()
    mark_job_done = Mock()
    mark_job_failed = Mock()
    write_status_file = Mock()

    monkeypatch.setattr(worker, "get_supabase_client", lambda: fake_supabase)
    monkeypatch.setattr(worker, "fetch_pending_job", lambda client: JOB)
    monkeypatch.setattr(worker, "mark_job_running", Mock(return_value=True))
    monkeypatch.setattr(worker, "run_job", run_job)
    monkeypatch.setattr(worker, "mark_job_done", mark_job_done)
    monkeypatch.setattr(worker, "mark_job_failed", mark_job_failed)
    monkeypatch.setattr(worker, "write_status_file", write_status_file)

    return run_job, mark_job_done, mark_job_failed, write_status_file


def test_main_records_system_exit_as_failed_job(monkeypatch, fake_supabase):
    run_job, mark_job_done, mark_job_failed, write_status_file = _setup_worker(
        monkeypatch, fake_supabase
    )
    run_job.side_effect = SystemExit(1)

    result = worker.main()

    assert result == 1
    mark_job_failed.assert_called_once_with(
        fake_supabase, JOB["id"], "aborted: SystemExit(code=1)"
    )
    write_status_file.assert_called_once_with(fake_supabase)
    mark_job_done.assert_not_called()


def test_main_keeps_regular_exception_failure_path(monkeypatch, fake_supabase):
    run_job, mark_job_done, mark_job_failed, write_status_file = _setup_worker(
        monkeypatch, fake_supabase
    )
    run_job.side_effect = RuntimeError("boom")

    result = worker.main()

    assert result == 1
    mark_job_failed.assert_called_once_with(fake_supabase, JOB["id"], "boom")
    write_status_file.assert_called_once_with(fake_supabase)
    mark_job_done.assert_not_called()


def test_main_marks_successful_job_done(monkeypatch, fake_supabase):
    run_job, mark_job_done, mark_job_failed, write_status_file = _setup_worker(
        monkeypatch, fake_supabase
    )

    result = worker.main()

    assert result == 0
    run_job.assert_called_once_with(fake_supabase, JOB, dry_run=False)
    mark_job_done.assert_called_once_with(fake_supabase, JOB["id"])
    mark_job_failed.assert_not_called()
    write_status_file.assert_called_once_with(fake_supabase)
