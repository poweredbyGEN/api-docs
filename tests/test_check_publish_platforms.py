"""Acceptance tests for scripts/check_publish_platforms.py (GEN-6715, GEN-7755).

Each test fails on the base commit: the script does not exist there (tests 1-3),
the publishing page still said "Currently TikTok" (test 4) and the new behaviour
was undocumented (test 5).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "check_publish_platforms.py"
PUBLISHING_MDX = REPO / "src/content/docs/reference/publishing.mdx"

SIX_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "x", "linkedin"]
MISSING_PLATFORM_PATHS = (
    "src/content/docs/reference/publishing.mdx",
    "public/llms-full.txt",
    "public/openapi.yaml",
    "public/.well-known/openapi.yaml",
)


def run_check(root: Path, tmp_path: Path, platforms) -> subprocess.CompletedProcess:
    """Run the check script against `root` with a saved platform fixture."""
    fixture = tmp_path / "publish-platforms.json"
    fixture.write_text(json.dumps(platforms), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), "--platforms-json", str(fixture)],
        capture_output=True,
        text=True,
    )


def output_of(result: subprocess.CompletedProcess) -> str:
    return result.stdout + result.stderr


def repo_copy(destination: Path) -> Path:
    shutil.copytree(REPO, destination, ignore=shutil.ignore_patterns(".git", "node_modules", "dist", "__pycache__"))
    return destination


@pytest.mark.parametrize(
    "payload",
    [
        [{"platform": value, "label": value.title()} for value in SIX_PLATFORMS],
        {"platforms": [{"platform": value} for value in SIX_PLATFORMS]},
    ],
    ids=["platforms-array", "response-object"],
)
def test_six_served_platforms_are_documented(tmp_path, payload):
    result = run_check(REPO, tmp_path, payload)
    assert result.returncode == 0, output_of(result)
    assert "PASS" in result.stdout


def test_seventh_platform_reports_every_missing_place(tmp_path):
    result = run_check(REPO, tmp_path, SIX_PLATFORMS + ["threads"])
    assert result.returncode == 1
    output = output_of(result)
    for path in MISSING_PLATFORM_PATHS:
        named = [line for line in output.splitlines() if path in line and "threads" in line]
        assert named, f"{path} not named for `threads` in:\n{output}"
    assert "public/openapi.yaml:" in output
    assert "public/.well-known/openapi.yaml:" in output


def test_retired_tool_name_outside_the_changelog_is_red(tmp_path):
    root = repo_copy(tmp_path / "tree")
    llms_txt = root / "public/llms.txt"
    llms_txt.write_text(
        llms_txt.read_text(encoding="utf-8") + "\nUse `gen_get_social_connect_url` to connect an account.\n",
        encoding="utf-8",
    )
    result = run_check(root, tmp_path, SIX_PLATFORMS)
    assert result.returncode == 1
    named = [line for line in output_of(result).splitlines() if "public/llms.txt" in line and "gen_get_social_connect_url" in line]
    assert named, output_of(result)


def test_retired_tool_name_inside_a_changelog_page_is_green(tmp_path):
    root = repo_copy(tmp_path / "tree")
    changelog = root / "src/content/docs/changelog/2026-09-22-mcp-catalog-collapse.mdx"
    assert changelog.is_file()
    changelog.write_text(
        changelog.read_text(encoding="utf-8") + "\n| `gen_get_social_connect_url` | retired -> `gen_discover` |\n",
        encoding="utf-8",
    )
    result = run_check(root, tmp_path, SIX_PLATFORMS)
    assert result.returncode == 0, output_of(result)


def test_no_currently_tiktok_claim_under_src():
    hits = []
    for path in sorted((REPO / "src").rglob("*")):
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                if "Currently TikTok" in line:
                    hits.append(f"{path.relative_to(REPO)}:{lineno}: {line.strip()}")
    assert not hits, "stale TikTok claim:\n" + "\n".join(hits)


def test_publishing_page_documents_the_new_behaviour():
    text = PUBLISHING_MDX.read_text(encoding="utf-8")
    assert "/schedule/post/{post_id}/metrics" in text
    assert "tiktok_private_only" in text
    linkedin_editable = re.search(r"linkedin[^\n]*editable_after_publish|editable_after_publish[^\n]*linkedin", text, re.IGNORECASE)
    assert linkedin_editable, "publishing.mdx does not tie LinkedIn to editable_after_publish"
