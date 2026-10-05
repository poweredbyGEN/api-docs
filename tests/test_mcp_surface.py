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

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "sync_mcp_surface.py"
# `GEN_OPENAPI` and `GEN_MCP_SURFACE` let a reviewer point the server checks at
# scratch copies, which is how the wrong-host sabotage case is exercised without
# touching the committed files.
OPENAPI = Path(os.environ.get("GEN_OPENAPI") or (REPO / "public" / "openapi.yaml"))
SURFACE = Path(os.environ.get("GEN_MCP_SURFACE") or (REPO / "scripts" / "mcp-surface.json"))
# `GEN_OPERATION_SCHEMAS` lets a test (or a reviewer) point the schema checks at
# a scratch copy, which is how the fake-key sabotage case is exercised without
# touching the committed file. It defaults to the committed one.
SCHEMAS = Path(os.environ.get("GEN_OPERATION_SCHEMAS") or (REPO / "scripts" / "operation-schemas.json"))
BASELINE = REPO / "scripts" / "openapi-missing-baseline.json"

METHODS = ("get", "post", "put", "patch", "delete")

# `operation-schemas.json` names the repository each shape was read from, so one
# file can cite gen-backend-v2, gen-agentic, agent-core and gen-backend-python at
# once. Each repository is checked against its own checkout, and a checkout that
# is not configured is skipped rather than failed: the docs suite must still run
# from a docs-only clone.
REPO_ENV = {
    "gen-backend-v2": "GEN_BACKEND_PATH",
    "gen-agentic": "GEN_AGENTIC_PATH",
    "agent-core": "AGENT_CORE_PATH",
    "gen-backend-python": "GEN_BACKEND_PYTHON_PATH",
}


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


def top_level_servers(text):
    """The document default hosts, read from the spec's own `servers:` block."""
    lines = text.split("\n")
    start = next(i for i, line in enumerate(lines) if line == "servers:")
    urls = []
    for line in lines[start + 1:]:
        if line and not line.startswith(" "):
            break
        match = re.match(r"^  - url:\s*(\S+)\s*$", line)
        if match:
            urls.append(match.group(1))
    assert urls, "the spec declares no top-level servers"
    return urls


def operation_servers(text):
    """`{(METHOD, path): [servers]}` — the operation-level override, else the default."""
    default = top_level_servers(text)[0]
    lines = text.split("\n")
    start = lines.index("paths:")
    end = next(i for i, line in enumerate(lines) if line.startswith("components:"))
    override = {}
    path = method = None
    collecting = False
    for line in lines[start + 1:end]:
        match = re.match(r"^  (/\S.*):\s*$", line)
        if match:
            path, method, collecting = match.group(1), None, False
            continue
        match = re.match(r"^    (get|post|put|patch|delete):\s*$", line)
        if match and path is not None:
            method = match.group(1)
            override[(method.upper(), path)] = []
            collecting = False
            continue
        if method is None:
            continue
        if re.match(r"^      servers:\s*$", line):
            collecting = True
            continue
        if collecting:
            match = re.match(r"^        - url:\s*(\S+)\s*$", line)
            if match:
                override[(method.upper(), path)].append(match.group(1))
            elif line.strip():
                collecting = False
    return {key: (value or [default]) for key, value in override.items()}


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
    schemas = json.loads(SCHEMAS.read_text())
    failures = []
    for key, block in parse_paths(OPENAPI.read_text()).items():
        text = "\n".join(block)
        match = re.search(r"^        '2(\d\d)':\s*$", text, re.M)
        has_schema = False
        if match:
            # 204/205 carry no body by definition, so a documented success at one
            # of them is complete without a schema (`head :no_content`).
            if int("2" + match.group(1)) in (204, 205):
                continue
            rest = text[match.end():]
            following = re.search(r"^        '\d", rest, re.M)
            segment = rest[: following.start()] if following else rest
            has_schema = bool(re.search(r"schema:|\$ref:", segment, re.M))
        # An entry may declare the success carries no body (`noContent`) or lives
        # at a non-2xx status (`responseStatus`, x402's 402 quote); either is an
        # explicit, sourced contract rather than a missing schema.
        entry = schemas.get(f"{key[0]} {key[1]}") or {}
        declared = bool(entry.get("noContent")) or entry.get("responseStatus") is not None
        if not has_schema and not declared and "x-schema-status: missing" not in text:
            failures.append(key)
    assert failures == []


def test_character_deletes_declare_204_and_render_it():
    """A vendored character DELETE declares the 204 its controller answers, and the render says 204.

    `V1::AvatarsController#destroy` (serving /v1/characters) ends in
    `head :no_content`, so the vendored characters schema marks the route
    `noContent`. Without an explicit `responseStatus` the generated operation
    kept the seeded placeholder 200 and advertised a success the backend never
    returns. The operation is rendered here from the generators, so dropping the
    declaration fails this test even while the committed YAML still says 204.
    """
    module = load_module()
    characters = json.loads((REPO / "scripts" / "backend" / "characters-api-schema.json").read_text())
    entries = module.character_schema_entries(characters)
    surface = {f"{method} {path}" for method, path in surface_operations()}
    character_deletes = {key: entry for key, entry in entries.items() if key.startswith("DELETE ") and key in surface}
    assert character_deletes, "the vendored characters schema carries no DELETE on the MCP surface"
    for key, entry in character_deletes.items():
        assert entry.get("noContent") is True, f"{key}: a DELETE answers with no body"
        assert entry.get("responseStatus") == 204, f"{key}: a DELETE answers 204, got {entry.get('responseStatus')!r}"

    schemas = json.loads(SCHEMAS.read_text())
    schemas.update({key: entry for key, entry in entries.items() if key in surface})
    seed = json.loads((REPO / "scripts" / "openapi-operations.json").read_text())
    contract = json.loads((REPO / "scripts" / "backend" / "public-contract.json").read_text())
    body, _ = module.render_paths(json.loads(SURFACE.read_text())["operations"], seed, contract, schemas)
    rendered = parse_paths(module.render_paths_file(OPENAPI.read_text(), body))
    committed = parse_paths(OPENAPI.read_text())
    for key in character_deletes:
        method, path = key.split(" ", 1)
        for label, operations in (("rendered", rendered), ("committed", committed)):
            text = "\n".join(operations[(method, path)])
            assert re.search(r"^        '204':\s*$", text, re.M), f"{key}: {label} without a 204"
            assert not re.search(r"^        '200':\s*$", text, re.M), f"{key}: {label} a 200 the backend never returns"


def test_character_routes_replace_the_avatar_routes():
    """gen_characters is documented under /characters; /avatars is only a named deprecated alias.

    Every /characters response schema the generator declares is a route of the
    vendored characters schema, the surface carries no /avatars operation and no
    retired gen_avatars owner, and each /characters operation names the
    /avatars route that still answers for it.
    """
    module = load_module()
    characters = json.loads((REPO / "scripts" / "backend" / "characters-api-schema.json").read_text())
    routes = {key.replace(" /v1/", " /", 1) for key in characters["requests"]}
    assert set(module.CHARACTER_RESPONSES) <= routes, sorted(set(module.CHARACTER_RESPONSES) - routes)

    entries = json.loads(SURFACE.read_text())["operations"]
    assert not [e for e in entries if e["path"].startswith("/avatars")]
    assert not [e for e in entries if e["mcp_tool"] == "gen_avatars"]
    owned = [e for e in entries if e["mcp_tool"] == "gen_characters"]
    assert owned and all(e["path"].startswith("/characters") for e in owned)

    assert module.deprecated_alias("/characters/{character_id}/talking_characters/{id}") == "/avatars/{avatar_id}/talking_loops/{id}"
    assert module.deprecated_alias("/agents/{agent_id}/avatars") is None
    documented = parse_paths(OPENAPI.read_text())
    for entry in owned:
        text = "\n".join(documented[(entry["method"], entry["path"])])
        alias = module.deprecated_alias(entry["path"])
        assert f"{entry['method']} /v1{alias} is the deprecated name" in text, (entry["method"], entry["path"])


def test_gen_characters_branches_resolve_through_the_avatar_handlers():
    """`_CHARACTER_OPS` maps each gen_characters op onto the gen_avatars handler that runs it."""
    import ast

    module = load_module()
    server = ast.parse(
        "_AVATAR_HANDLERS = {'list': _avatars_list, 'delete_avatar_look': lambda a, p: _avatars_delete(a, p, 'look')}\n"
        "_CHARACTER_OPS = {'list': 'list', 'delete_look': 'delete_avatar_look', 'ghost': 'no_such_op'}\n"
    )
    handlers = module._branch_handlers(server, ast.parse("FAMILIES = []"))
    assert handlers[("gen_characters", "list")] == ["_avatars_list"]
    assert handlers[("gen_characters", "delete_look")] == ["_avatars_delete"]
    assert ("gen_characters", "ghost") not in handlers


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


def test_operation_schemas_use_coherent_markers():
    """An entry's contract markers are explicit and each is backed by a cited `source`.

    `noContent` and `response` are mutually exclusive (a success either carries a
    body or does not), `responseStatus` only qualifies a declared `response`, and
    every marker needs at least one backend file behind it — a marker copied in
    without the controller line that justifies it is exactly the guess this file
    exists to prevent.
    """
    schemas = json.loads(SCHEMAS.read_text())
    problems = []
    for key, entry in schemas.items():
        if not entry.get("source"):
            problems.append(f"{key}: no source")
        if entry.get("noContent") and "response" in entry:
            problems.append(f"{key}: declares both noContent and response")
        if entry.get("responseStatus") is not None and "response" not in entry:
            problems.append(f"{key}: responseStatus without a response")
    assert problems == [], problems


def test_explicit_markers_satisfy_a_bodyless_write():
    """`noRequestBody`/`noContent` clear a write the backend serves with no body.

    A write whose controller reads only path params (`head :ok`) has no schema to
    copy; the entry asserts that explicitly instead of guessing one. Without the
    markers the same operation stays `missing`.
    """
    module = load_module()
    surface = [
        {
            "method": "POST",
            "path": "/zzz_bodyless_probe",
            "operationId": "postZzzBodylessProbe",
            "tag": "Discovery",
            "summary": "Probe",
            "mcp_tool": "gen_discover",
            "mcp_branch": "probe",
            "mcp_owners": [{"tool": "gen_discover", "branch": "probe"}],
        }
    ]
    seed = {"paths": []}
    contract = json.loads((REPO / "scripts" / "backend" / "public-contract.json").read_text())
    schemas = {
        "POST /zzz_bodyless_probe": {
            "noRequestBody": True,
            "noContent": True,
            "source": ["gen-backend-v2:app/controllers/v1/organizations_controller.rb#show"],
        }
    }
    _, marked = module.render_paths(surface, seed, contract, schemas)
    assert marked[("POST", "/zzz_bodyless_probe")]["missing"] is False
    _, plain = module.render_paths(surface, seed, contract)
    assert plain[("POST", "/zzz_bodyless_probe")]["missing"] is True


def test_operation_schemas_cite_backend_sources():
    """Every entry names the backend code it was derived from, and a checkout confirms it.

    Each `source` is `<repo>:<path>` — `<repo>:<path>#<symbol>` when the shape
    came from one method, class or resource. The file-existence check runs per
    repository and only when that repository's env var points at a checkout, so
    this suite still runs from a docs-only clone. The check reads the repository's
    `origin/main` blob, never the working tree: a local branch can be behind, and a
    source that only exists in a stale checkout would make a passing test a lie.
    """
    schemas = json.loads(SCHEMAS.read_text())
    empty = sorted(key for key, entry in schemas.items() if not entry.get("source"))
    assert empty == [], f"operation-schemas.json entries without a `source` list: {empty}"
    incomplete = sorted(
        key
        for key, entry in schemas.items()
        if not any(field in entry for field in ("requestBody", "response", "noContent", "noRequestBody"))
    )
    assert incomplete == [], f"operation-schemas.json entries with no contract field: {incomplete}"

    unnamed = []
    for key, entry in schemas.items():
        for reference in entry["source"]:
            repo, _, rest = reference.partition(":")
            if repo not in REPO_ENV or not rest:
                unnamed.append(f"{key}: {reference}")
    assert unnamed == [], f"operation-schemas.json sources without a `<repo>:<path>` name: {unnamed}"

    missing = []
    for repo, env in REPO_ENV.items():
        checkout = os.environ.get(env)
        if not checkout:
            continue
        for key, entry in schemas.items():
            for reference in entry["source"]:
                source_repo, _, location = reference.partition(":")
                if source_repo != repo:
                    continue
                relative = location.split("#", 1)[0]
                if not backend_file_exists(checkout, relative):
                    missing.append(f"{key}: {reference}")
    assert missing == [], f"operation-schemas.json sources not found on origin/main: {missing}"


def backend_file_exists(checkout, relative):
    """`origin/main:<path>` exists in the checkout? Falls back to `HEAD` when the ref is absent."""
    for revision in ("origin/main", "HEAD"):
        ref = subprocess.run(
            ["git", "-C", checkout, "rev-parse", "--verify", "--quiet", revision],
            capture_output=True,
            text=True,
        )
        if ref.returncode != 0:
            continue
        blob = subprocess.run(
            ["git", "-C", checkout, "cat-file", "-e", f"{revision}:{relative}"],
            capture_output=True,
            text=True,
        )
        return blob.returncode == 0
    return False


def test_every_operation_server_equals_its_surface_entry():
    """The host an operation documents is the host its MCP branch calls.

    `mcp-surface.json` carries the derived `server`; the spec must render exactly
    that, as an operation-level `servers:` override for anything but the document
    default. A mismatch sends a caller to a backend that does not serve the route.
    """
    surface = {f"{entry['method']} {entry['path']}": entry.get("server") for entry in json.loads(SURFACE.read_text())["operations"]}
    rendered = operation_servers(OPENAPI.read_text())
    mismatches = []
    for (method, path), servers in rendered.items():
        expected = surface.get(f"{method} {path}")
        if len(servers) != 1 or servers[0] != expected:
            mismatches.append(f"{method} {path}: documented {servers}, surface {expected}")
    assert mismatches == [], mismatches


def test_top_level_servers_cover_every_operation_server():
    """Every host an operation uses is declared at the top of the spec."""
    text = OPENAPI.read_text()
    declared = set(top_level_servers(text))
    used = {server for servers in operation_servers(text).values() for server in servers}
    assert used <= declared, f"operation servers missing from `servers:`: {sorted(used - declared)}"


def test_every_surface_operation_names_a_server():
    module = load_module()
    entries = json.loads(SURFACE.read_text())["operations"]
    unknown = sorted(
        f"{entry['method']} {entry['path']}"
        for entry in entries
        if entry.get("server") not in module.TOP_LEVEL_SERVERS
    )
    assert unknown == [], f"surface operations without a known server: {unknown}"


def test_derived_servers_match_the_mcp_source():
    """With a gen-mcp-server checkout, re-derive every host from the MCP source.

    This catches the case the self-consistency check cannot: the committed
    `server` and the rendered doc agreeing with each other while both are wrong.
    """
    mcp = os.environ.get("GEN_MCP_PATH")
    if not mcp:
        pytest.skip("GEN_MCP_PATH is not set; the MCP source is not available")
    module = load_module()
    entries = json.loads(SURFACE.read_text())["operations"]
    derived = module.derive_servers(entries, mcp)
    mismatches = []
    for entry in entries:
        key = f"{entry['method']} {entry['path']}"
        if derived[key][0] != entry.get("server"):
            mismatches.append(f"{key}: surface {entry.get('server')}, MCP source {derived[key][0]}")
    assert mismatches == [], mismatches


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
