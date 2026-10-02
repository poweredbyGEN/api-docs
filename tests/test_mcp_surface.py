"""Acceptance tests for scripts/sync_mcp_surface.py.

The MCP surface is the public contract: `public/openapi.yaml` must document
exactly the backend routes an MCP tool calls, every write must carry a request
body, and every operation must carry a 2xx response schema — or declare
`x-schema-status: missing` while the missing count stays within the committed
baseline. These tests fail when any of those breaks.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "sync_mcp_surface.py"
OPENAPI = REPO / "public" / "openapi.yaml"
SURFACE = REPO / "scripts" / "mcp-surface.json"
# `GEN_OPERATION_SCHEMAS` lets a test (or a reviewer) point the schema checks at
# a scratch copy, which is how the fake-key sabotage case is exercised without
# touching the committed file. It defaults to the committed one.
SCHEMAS = Path(os.environ.get("GEN_OPERATION_SCHEMAS") or (REPO / "scripts" / "operation-schemas.json"))
BASELINE = REPO / "scripts" / "openapi-missing-baseline.json"

METHODS = ("get", "post", "put", "patch", "delete")


def load_module():
    spec = importlib.util.spec_from_file_location("sync_mcp_surface", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_paths(text):
    lines = text.split("\n")
    start = lines.index("paths:")
    end = next(i for i, line in enumerate(lines) if line.startswith("components:"))
    operations = {}
    path = None
    method = None
    for line in lines[start + 1:end]:
        match = re.match(r"^  (/\S.*):\s*$", line)
        if match:
            path = match.group(1)
            method = None
            continue
        match = re.match(r"^    (get|post|put|patch|delete):\s*$", line)
        if match and path is not None:
            method = match.group(1)
            operations[(method.upper(), path)] = []
            continue
        if path is not None and method is not None:
            operations[(method.upper(), path)].append(line)
    return operations


def surface_operations():
    return [(entry["method"], entry["path"]) for entry in json.loads(SURFACE.read_text())["operations"]]


def test_check_passes():
    result = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_surface_is_exactly_the_openapi_operations():
    documented = set(parse_paths(OPENAPI.read_text()))
    expected = set(surface_operations())
    assert documented == expected


def test_every_write_has_a_body_or_is_marked_missing():
    failures = []
    for key, block in parse_paths(OPENAPI.read_text()).items():
        if key[0] not in ("POST", "PUT", "PATCH"):
            continue
        text = "\n".join(block)
        if not re.search(r"^      requestBody:", text, re.M) and "x-schema-status: missing" not in text:
            failures.append(key)
    assert failures == []


def test_every_operation_has_a_2xx_schema_or_is_marked_missing():
    failures = []
    for key, block in parse_paths(OPENAPI.read_text()).items():
        text = "\n".join(block)
        match = re.search(r"^        '2\d\d':\s*$", text, re.M)
        has_schema = False
        if match:
            rest = text[match.end():]
            following = re.search(r"^        '\d", rest, re.M)
            segment = rest[: following.start()] if following else rest
            has_schema = bool(re.search(r"schema:|\$ref:", segment, re.M))
        if not has_schema and "x-schema-status: missing" not in text:
            failures.append(key)
    assert failures == []


def test_missing_count_does_not_grow():
    documented = parse_paths(OPENAPI.read_text())
    missing = sum(1 for block in documented.values() if "x-schema-status: missing" in "\n".join(block))
    assert missing <= json.loads(BASELINE.read_text())["missing"]


def test_operation_schemas_key_the_real_surface():
    """Every recorded schema must belong to an operation the surface actually serves.

    A key with no matching `mcp-surface.json` operation would document a route the
    MCP never calls, and `sync_mcp_surface.py` refuses to render one.
    """
    surface = {f"{method} {path}" for method, path in surface_operations()}
    recorded = set(json.loads(SCHEMAS.read_text()))
    unknown = sorted(recorded - surface)
    assert unknown == [], f"operation-schemas.json keys with no surface operation: {unknown}"


def test_operation_schemas_cite_backend_sources():
    """Every entry names the backend code it was derived from, and a backend checkout confirms it.

    The file-existence check runs only when GEN_BACKEND_PATH points at a checkout of
    the backend repository, so this suite still runs from a docs-only clone.
    """
    schemas = json.loads(SCHEMAS.read_text())
    empty = sorted(key for key, entry in schemas.items() if not entry.get("source"))
    assert empty == [], f"operation-schemas.json entries without a `source` list: {empty}"
    incomplete = sorted(
        key for key, entry in schemas.items() if "requestBody" not in entry and "response" not in entry
    )
    assert incomplete == [], f"operation-schemas.json entries with neither requestBody nor response: {incomplete}"

    backend = os.environ.get("GEN_BACKEND_PATH")
    if not backend:
        return
    missing = []
    for key, entry in schemas.items():
        for reference in entry["source"]:
            relative = reference.split("#", 1)[0]
            if not (Path(backend) / relative).exists():
                missing.append(f"{key}: {reference}")
    assert missing == [], f"operation-schemas.json sources not found in GEN_BACKEND_PATH: {missing}"


def test_set_default_user_job_body_is_nested():
    """The default-take write takes a `default_user_job` wrapper, not a flat body.

    The controller reads `params.expect(default_user_job: [:user_job_id, :is_user_job])`,
    so a flat `{user_job_id}` body is dropped by strong parameters and the pin
    silently does nothing. This catches a regression to the flat hand-written shape.
    """
    block = parse_paths(OPENAPI.read_text())[("PATCH", "/vidsheet/{sheet_id}/cells/{cell_id}/set_default_user_job")]
    text = "\n".join(block)
    body = text[text.index("      requestBody:"):text.index("      responses:")]
    assert "default_user_job:" in body, body
    assert "user_job_id" in body, body


def test_regeneration_adds_a_fake_route():
    module = load_module()
    surface = json.loads(SURFACE.read_text())["operations"]
    fake = {
        "method": "GET",
        "path": "/zzz_test_probe",
        "operationId": "getZzzTestProbe",
        "tag": "Discovery",
        "summary": "Probe",
        "mcp_tool": "gen_discover",
        "mcp_branch": "probe",
        "mcp_owners": [{"tool": "gen_discover", "branch": "probe"}],
    }
    seed = json.loads((REPO / "scripts" / "openapi-operations.json").read_text())
    contract = json.loads((REPO / "scripts" / "backend" / "public-contract.json").read_text())
    before, _ = module.render_paths(surface, seed, contract)
    after, _ = module.render_paths(surface + [fake], seed, contract)
    assert after[: len(before)] == before
    added = after[len(before):]
    assert added[0].strip() == "/zzz_test_probe:"
    assert any("operationId: getZzzTestProbe" in line for line in added)
    assert any("x-schema-status: missing" in line for line in added)
