#!/usr/bin/env python3
"""GEN-6715 (docs half) / GEN-7755: adding a platform to the publishing API is
only half a change unless the docs move with it.

The platform list the API validates against is served by
https://python.gen.pro/schedule/platforms (the same endpoint the docs publish as
`GET /v1/schedule/platforms`). Every value it serves must have a row in the
platform table of the publishing page and of llms-full.txt, and must appear in
the publish platform enum of both OpenAPI copies. The check also keeps the
retired MCP tool names off the two doc surfaces and the stale "Currently TikTok"
claim out of the site.

The MCP half of the same rule lives in gen-mcp-server .woodpecker/ci.yml, which
compares the vendored MCP enum with a fresh read of that endpoint; this is the
docs half, so a platform can no longer be added to python alone.

The list comes from the live URL; `--platforms-json` takes a saved copy (the
`platforms` array, or the whole response) for offline runs and tests. A fetch,
parse or shape failure is red, never a skip: a docs gate that cannot see the
served list proves nothing (GEN-6697).

Run: python3 scripts/check_publish_platforms.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

LIVE_PLATFORMS_URL = "https://python.gen.pro/schedule/platforms"

# The doc surfaces that must carry one table row per served platform.
PLATFORM_TABLE_FILES = (
    "src/content/docs/reference/publishing.mdx",
    "public/llms-full.txt",
)
# Both published copies of the spec; they are edited by different tooling, so
# each is checked on its own.
OPENAPI_FILES = (
    "public/openapi.yaml",
    "public/.well-known/openapi.yaml",
)

# MCP tools that no longer exist. src/content/docs/changelog/ keeps the old
# names on purpose (the catalog-collapse page maps old -> new), so it is exempt
# from this scan; nothing else may send a reader to a retired tool.
RETIRED_TOOL_NAMES = (
    "gen_get_social_connect_url",
    "gen_list_connected_socials",
    "gen_disconnect_social",
    "gen_schedule_post",
)
CHANGELOG_DIR = "src/content/docs/changelog"
STALE_PHRASE = "Currently TikTok"
# The doc surfaces a reader or an LLM client can reach.
SCAN_DIRS = ("src", "public")

CODE_SPAN = re.compile(r"`([^`\n]+)`")
ENUM_INLINE = re.compile(r"^\s*enum:\s*\[(.*)\]\s*$")
ENUM_HEADER = re.compile(r"^\s*enum:\s*$")
ENUM_ITEM = re.compile(r"^\s*-\s*(\S+)\s*$")
SCHEMA_HEADER = re.compile(r"^    ([A-Za-z_][\w]*):\s*$")
SCHEMAS_KEY = re.compile(r"^  schemas:\s*$")


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def served_platforms(args: argparse.Namespace) -> list[str]:
    """The platform values the API serves, in served order."""
    if args.platforms_json:
        path = Path(args.platforms_json)
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as err:
            fail(f"{path}: {err}")
        source = str(path)
    else:
        try:
            with urllib.request.urlopen(LIVE_PLATFORMS_URL, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except (urllib.error.URLError, OSError, ValueError) as err:
            fail(f"{LIVE_PLATFORMS_URL}: {err}")
        source = LIVE_PLATFORMS_URL

    try:
        data = json.loads(raw)
    except ValueError as err:
        fail(f"{source}: not JSON ({err})")
    rows = data.get("platforms") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        fail(f"{source}: no platforms array ({type(data).__name__} with keys {list(data) if isinstance(data, dict) else data!r})")

    values = []
    for row in rows:
        value = row.get("platform") if isinstance(row, dict) else row
        if not isinstance(value, str) or not value.strip():
            fail(f"{source}: platform entry without a platform value: {row!r}")
        values.append(value.strip())
    # A truncated or empty response would otherwise pass every coverage check.
    if len(values) < 3:
        fail(f"{source}: only {len(values)} platform(s) served; refusing to trust the response")
    return values


def platform_table_cells(text: str) -> set[str]:
    """Every code span of every row of the platform table.

    The platform table is the Markdown table whose header names the `platform`
    field; a value spelled out in prose or in another table (the create-body
    field table also lists the platforms) does not count as a platform row.
    """
    cells: set[str] = set()
    block: list[str] = []
    for line in text.splitlines() + [""]:
        if line.lstrip().startswith("|"):
            block.append(line)
            continue
        if block:
            if "`platform`" in block[0]:
                for row in block[1:]:
                    cells.update(CODE_SPAN.findall(row))
            block = []
    return cells


def enum_values(lines: list[str], index: int) -> tuple[int, list[str]] | None:
    """The enum that starts at lines[index] as (line number, values)."""
    inline = ENUM_INLINE.match(lines[index])
    if inline:
        values = [value.strip().strip("'\"") for value in inline.group(1).split(",")]
        return index + 1, [value for value in values if value]
    if ENUM_HEADER.match(lines[index]):
        values = []
        cursor = index + 1
        while cursor < len(lines):
            item = ENUM_ITEM.match(lines[cursor])
            if not item:
                break
            values.append(item.group(1).strip("'\""))
            cursor += 1
        if values:
            return index + 1, values
    return None


def component_schemas(lines: list[str]) -> list[tuple[str, int, int]]:
    """(name, start, end) index ranges of the component schemas in an OpenAPI file."""
    try:
        first = next(i for i, line in enumerate(lines) if SCHEMAS_KEY.match(line))
    except StopIteration:
        return []
    blocks: list[tuple[str, int, int]] = []
    name: str | None = None
    start = 0
    for i in range(first + 1, len(lines)):
        header = SCHEMA_HEADER.match(lines[i])
        if header:
            if name is not None:
                blocks.append((name, start, i))
            name, start = header.group(1), i
    if name is not None:
        blocks.append((name, start, len(lines)))
    return blocks


def publish_platform_enums(text: str) -> list[tuple[int, list[str], str]]:
    """(line number, values, label) for every enum list of the publish platform field.

    The canonical list is the `PublishPlatform` schema every publish request
    `$ref`s; an inline `enum:` under a `platform:` key of a publish schema is
    the same field spelled out, so it is checked too.
    """
    lines = text.splitlines()
    found: list[tuple[int, list[str], str]] = []
    for name, start, end in component_schemas(lines):
        for i in range(start, end):
            if name == "PublishPlatform":
                parsed = enum_values(lines, i)
                if parsed:
                    found.append((parsed[0], parsed[1], "PublishPlatform enum"))
            elif "Publish" in name and re.match(r"^\s+platform:\s*$", lines[i]):
                parsed = enum_values(lines, i + 1) if i + 1 < end else None
                if parsed:
                    found.append((parsed[0], parsed[1], f"{name}.platform enum"))
    return found


def check_platform_coverage(root: Path, platforms: list[str]) -> list[str]:
    problems: list[str] = []
    for rel in PLATFORM_TABLE_FILES:
        path = root / rel
        if not path.is_file():
            problems.append(f"{rel}: file not found")
            continue
        cells = platform_table_cells(path.read_text(encoding="utf-8"))
        for value in platforms:
            if value not in cells:
                problems.append(f"{rel}: no platform table row with the code cell `{value}`")
    for rel in OPENAPI_FILES:
        path = root / rel
        if not path.is_file():
            problems.append(f"{rel}: file not found")
            continue
        enums = publish_platform_enums(path.read_text(encoding="utf-8"))
        if not enums:
            problems.append(f"{rel}: no publish platform enum found")
            continue
        for value in platforms:
            for _, values, label in enums:
                if value not in values:
                    problems.append(f"{rel}: {label} is missing `{value}`")
    return problems


def check_retired_names_and_stale_claims(root: Path) -> list[str]:
    problems: list[str] = []
    for dirname in SCAN_DIRS:
        base = root / dirname
        if not base.is_dir():
            problems.append(f"{dirname}/: directory not found")
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if rel.startswith(CHANGELOG_DIR + "/"):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue  # binary asset (favicon, logo, image): no prose to check
            for lineno, line in enumerate(text.splitlines(), 1):
                for name in RETIRED_TOOL_NAMES:
                    if name in line:
                        problems.append(f"{rel}:{lineno}: retired MCP tool `{name}`")
                if STALE_PHRASE in line:
                    problems.append(f'{rel}:{lineno}: stale claim "{STALE_PHRASE}"')
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every served publishing platform is documented (GEN-6715, GEN-7755).")
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent.parent),
        help="repo root to check (default: the checkout this script lives in)",
    )
    parser.add_argument(
        "--platforms-json",
        default=None,
        help=f"saved JSON copy of {LIVE_PLATFORMS_URL}, as an array or a response object (default: fetch the URL)",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    platforms = served_platforms(args)
    problems = check_platform_coverage(root, platforms) + check_retired_names_and_stale_claims(root)
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        print(f"FAIL: {len(problems)} publishing doc problem(s); {len(platforms)} platform(s) served: {', '.join(platforms)}", file=sys.stderr)
        return 1

    print(
        f"PASS: {len(platforms)} served publishing platform(s) documented in "
        f"{', '.join(PLATFORM_TABLE_FILES)} and the publish platform enum of "
        f"{', '.join(OPENAPI_FILES)}: {', '.join(platforms)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
