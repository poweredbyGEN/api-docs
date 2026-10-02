#!/usr/bin/env python3
"""Generate the public docs' MCP surface.

MCP is GEN's public contract, so `public/openapi.yaml` documents exactly the
backend routes an MCP tool calls: nothing more, nothing less. This script owns
four generated regions:

  public/openapi.yaml          the whole `paths:` body, between the
  public/.well-known/openapi.yaml
                               `gen:mcp-surface-paths` markers
  public/llms.txt              the endpoint list, between the
  public/llms-full.txt         `gen:mcp-surface-endpoints` markers
  public/openapi.yaml          the shared per-backend error envelopes, between
  public/.well-known/openapi.yaml
                               the `gen:error-envelope-schemas` and
                               `gen:error-envelope-responses` markers

Operation bodies are taken from, in order:

* `scripts/backend/public-contract.json` — the vendored Vidsheet wire contract
  (path/query/header parameters and request bodies) and the action envelope
  (top-level request fields and the full response schema);
* `scripts/openapi-operations.json` — the operation definitions the previous,
  hand-written spec carried for a surface route (an operation the MCP calls is
  kept exactly as written, with `x-mcp-tool`/`x-mcp-branch` added). The seed is
  extracted from that pre-migration spec, never from the generated file: doing
  the latter would fold the generated operations into the seed and the check
  would compare a rendering against itself.
* `scripts/operation-schemas.json` — request bodies and 2xx responses read out of
  the backend controllers, routers, Pydantic models and resources, keyed
  `METHOD /path`. Each `source` names the repository and the file it came from,
  `<repo>:<path>#<symbol>`, because the surface spans four backends. These fill
  only the half an operation is missing: a seeded request body or success schema
  is never replaced.
* otherwise the operation is emitted with `x-schema-status: missing` and its
  path parameters only. No field is ever invented.

Each `scripts/mcp-surface.json` operation also carries the backend it is served
from: `server` (one of the document's top-level `servers`) and `server_source`,
the MCP line that proves it. The script renders a per-operation `servers:`
override for every operation whose host is not `https://api.gen.pro/v1`.

Usage:
  python3 scripts/sync_mcp_surface.py                       # regenerate
  python3 scripts/sync_mcp_surface.py --check               # CI gate
  python3 scripts/sync_mcp_surface.py --init-seed --from <spec.yaml>   # re-seed
  python3 scripts/sync_mcp_surface.py --build-surface \\
      --coverage <api-mcp-coverage.json> --raw <final_raw.json>
  python3 scripts/sync_mcp_surface.py --derive-servers \\
      --mcp-src <gen-mcp-server checkout>                   # re-derive `server`
  python3 scripts/sync_mcp_surface.py --check --mcp-surface <surface.json>

`--check` re-renders from the committed inputs and exits 1 when a target
differs, when a surface operation has no known `server`, when a write lacks a
request body or an operation lacks a 2xx response schema without carrying
`x-schema-status: missing`, or when the missing count grows past
`scripts/openapi-missing-baseline.json`.

`--derive-servers` reads the gen-mcp-server source (a checkout passed with
`--mcp-src` or `GEN_MCP_PATH`) and rewrites `server`/`server_source` on every
surface operation, failing loudly on one it cannot resolve. It is the only
writer of those fields; `--check` never needs the MCP source, so CI re-renders
from the committed values.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURFACE_FILE = os.path.join(ROOT, "scripts", "mcp-surface.json")
SCHEMAS_FILE = os.path.join(ROOT, "scripts", "operation-schemas.json")
SEED_FILE = os.path.join(ROOT, "scripts", "openapi-operations.json")
BASELINE_FILE = os.path.join(ROOT, "scripts", "openapi-missing-baseline.json")
CONTRACT_FILE = os.path.join(ROOT, "scripts", "backend", "public-contract.json")
AVATARS_SCHEMA_FILE = os.path.join(ROOT, "scripts", "backend", "avatars-api-schema.json")
AVATAR_REQUEST_BODIES_FILE = os.path.join(ROOT, "scripts", "avatars-request-bodies.json")
OVERRIDES_FILE = os.path.join(ROOT, "scripts", "mcp-path-params.json")
OPENAPI_FILES = ["public/openapi.yaml", "public/.well-known/openapi.yaml"]
LLMS_FILES = ["public/llms.txt", "public/llms-full.txt"]
METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
WRITE_METHODS = ("POST", "PUT", "PATCH")
# Statuses that carry no response body by definition, so a documented success at
# one of them is a complete contract without a schema.
NO_CONTENT_STATUSES = (204, 205)

PATHS_START = "gen:mcp-surface-paths:start"
PATHS_END = "gen:mcp-surface-paths:end"
ENDPOINTS_TAG = "mcp-surface-endpoints"

# ---- servers ------------------------------------------------------------------
#
# The MCP reaches four backends, each through one client helper in
# gen-mcp-server's `src/gen_mcp_server/client.py`: Rails on api.gen.pro/v1
# (`api_call`), gen-agentic on agent.gen.pro/v1 (`agent_api_call`), agent-core
# on agent-core.gen.pro/v1 (`agent_core_api_call`) and the publishing
# integration service on python.gen.pro (`integration_api_call`). An operation
# documented under the wrong host sends a caller to a route that backend does
# not serve, so every surface entry carries the `server` its MCP branch
# actually calls.
#
# `server` is derived, never hand-written: `--derive-servers --mcp-src <dir>`
# re-reads the MCP source and fails loudly on an operation it cannot resolve,
# and `--check` re-renders the committed value into the docs.
API_SERVER = "https://api.gen.pro/v1"
AGENT_SERVER = "https://agent.gen.pro/v1"
AGENT_CORE_SERVER = "https://agent-core.gen.pro/v1"
PYTHON_SERVER = "https://python.gen.pro"
DEFAULT_SERVER = API_SERVER
TOP_LEVEL_SERVERS = (API_SERVER, AGENT_SERVER, AGENT_CORE_SERVER, PYTHON_SERVER)

# One base URL per client helper. `form_call` and `upload_call` post to Rails;
# `_paid_create` and `gated_delete` are local wrappers, resolved through the
# call graph like any other function.
CALL_SERVER = {
    "api_call": API_SERVER,
    "form_call": API_SERVER,
    "upload_call": API_SERVER,
    "internal_agent_access_call": API_SERVER,
    "agent_api_call": AGENT_SERVER,
    "agent_core_api_call": AGENT_CORE_SERVER,
    "integration_api_call": PYTHON_SERVER,
}

# Legacy Rails route segments the MCP still calls under their old names.
ROUTE_ALIASES = {
    "spreadsheets": "vidsheet",
    "spreadsheet_cells": "cells",
    "spreadsheet_rows": "rows",
    "spreadsheet_columns": "columns",
    "video_layers": "layers",
}

# ---- shared error envelopes --------------------------------------------------
#
# Every backend returns one error envelope. The public contract normalizes the
# machine-readable code to `code` and the human-readable detail to `message`,
# then keeps each backend's real extra fields (none invented). Shapes are read
# from scripts/backend/public-contract.json (Rails: `error_code`/`error` plus
# `errors`, `retryable`, `new_change_set_required`, `funding_error_kind`) and
# from the error responses already in the spec (python's `detail` carries
# `platform`/`field`/`errors`; agent and agent-core use the same simple
# code/message pair). The `code` enum is left out on purpose: a later lane fills
# it from the generated error catalogs.
ERROR_ENVELOPE_SCHEMAS = {
    "ApiError": {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "The stable machine-readable failure code."},
            "message": {"type": "string", "description": "Human-readable failure detail."},
            "errors": {
                "type": "array",
                "description": "Field-level validation failures.",
                "items": {"type": "object"},
            },
            "retryable": {"type": "boolean", "description": "Whether retrying can succeed without changing the request."},
            "new_change_set_required": {"type": "boolean", "description": "Whether the caller must begin a new edit group."},
            "funding_error_kind": {"type": "string", "description": "The credit or payment failure category."},
        },
    },
    "AgentError": {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "The stable machine-readable failure code."},
            "message": {"type": "string", "description": "Human-readable failure detail."},
        },
    },
    "AgentCoreError": {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "The stable machine-readable failure code."},
            "message": {"type": "string", "description": "Human-readable failure detail."},
        },
    },
    "PythonError": {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "The stable machine-readable failure code."},
            "message": {"type": "string", "description": "Human-readable failure detail."},
            "platform": {"type": "string", "description": "The platform that rejected the content."},
            "field": {"type": "string", "description": "The field that failed validation."},
            "errors": {
                "type": "array",
                "description": "Per-platform validation failures.",
                "items": {"type": "object"},
            },
        },
    },
}

# The shared 401 / validation-error response components each backend uses. Every
# backend documents a 422 validation error (Rails raises 422, the FastAPI
# services return 422 on request validation); the response components attach to
# an operation only when it lacks that status.
ERROR_RESPONSES = {
    API_SERVER: ("ApiUnauthorized", "ApiValidationError"),
    AGENT_SERVER: ("AgentUnauthorized", "AgentValidationError"),
    AGENT_CORE_SERVER: ("AgentCoreUnauthorized", "AgentCoreValidationError"),
    PYTHON_SERVER: ("PythonUnauthorized", "PythonValidationError"),
}

ERROR_RESPONSE_SCHEMA = {
    API_SERVER: "ApiError",
    AGENT_SERVER: "AgentError",
    AGENT_CORE_SERVER: "AgentCoreError",
    PYTHON_SERVER: "PythonError",
}

ERROR_SCHEMAS_START = "gen:error-envelope-schemas:start"
ERROR_SCHEMAS_END = "gen:error-envelope-schemas:end"
ERROR_RESPONSES_START = "gen:error-envelope-responses:start"
ERROR_RESPONSES_END = "gen:error-envelope-responses:end"

MCP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")

# A tag decides the journey phase the docs filter on. Every tag used here is
# declared in the spec's `tags:` list (the two additions, Avatars and Billing,
# are declared there too).
TAG_PHASE = {
    "Discovery": "setup",
    "API Keys": "setup",
    "Agents": "setup",
    "Organizations": "setup",
    "Agent Profile": "setup",
    "Agent Core": "setup",
    "Agent Voice": "setup",
    "Avatars": "setup",
    "Billing": "setup",
    "Agent Chat": "ideas",
    "Song Mixes": "ideas",
    "Sheets": "convert",
    "Templates": "convert",
    "Publishing": "export",
    "Watchlists": "monitoring",
    "Recurring Jobs": "monitoring",
    "Content Monitoring": "monitoring",
}

# Path families whose generated operations use a tag not already carried by a
# documented route of the same family.
TAG_RULES = [
    (re.compile(r"^/avatars"), "Avatars"),
    (
        re.compile(r"^/(credit_balance|credit_plans|credit_transactions|payment|subscription_upgrade|seat_checkout)"),
        "Billing",
    ),
    (re.compile(r"^/(agent|analyze|ideas|research)"), "Agent Chat"),
    (re.compile(r"^/agents/[^/]+/(smas|watchlists|monitoring)"), "Watchlists"),
    (re.compile(r"^/agents/[^/]+/recurring-jobs"), "Recurring Jobs"),
    (re.compile(r"^/agents/[^/]+/core"), "Agent Core"),
    (re.compile(r"^/agents/[^/]+/voice"), "Agent Voice"),
    (re.compile(r"^/(voice_resources|user_voice_resources|eleven_labs_job|generate_voice|hume_ai)"), "Agent Voice"),
    (re.compile(r"^/(platform|schedule)"), "Publishing"),
    (re.compile(r"^/(content_resources|direct_upload)"), "Content Resources"),
    (re.compile(r"^/(sound_libraries|recommended_sounds|audio_matching_jobs)"), "Song Mixes"),
    (re.compile(r"^/user_jobs"), "Generations"),
    (re.compile(r"^/user_shared_agents"), "Agents"),
    (re.compile(r"^/(organizations|projects)"), "Organizations"),
    (re.compile(r"^/x402"), "Organizations"),
    (re.compile(r"^/vidsheet/[^/]+/cells/[^/]+/layers"), "Layers"),
    (re.compile(r"^/vidsheet/[^/]+/cells"), "Cells"),
    (re.compile(r"^/vidsheet/[^/]+/operations"), "Sheets"),
    (re.compile(r"^/vidsheet"), "Sheets"),
    (re.compile(r"^/generations"), "Generations"),
    (re.compile(r"^/aura"), "Agent Profile"),
]


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def normalize(path):
    return re.sub(r"\{[^{}]*\}", "{}", path.split("?")[0])


def fill_path(path, names):
    """Replace the `{}` placeholders of a normalized route with real names."""
    parts = re.split(r"(\{\})", path)
    out = []
    index = 0
    for part in parts:
        if part == "{}":
            out.append("{" + names[index] + "}")
            index += 1
        else:
            out.append(part)
    if index != len(names):
        raise ValueError(f"{path}: {len(names)} names for {index} placeholders")
    return "".join(out)


def pascal(text):
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^A-Za-z0-9]+", text) if part)


def generate_operation_id(method, path):
    segments = [segment for segment in path.split("/") if segment]
    pieces = []
    for segment in segments:
        match = re.fullmatch(r"\{(\w+)\}", segment)
        if match:
            pieces.append("By" + pascal(match.group(1)))
        else:
            pieces.append(pascal(segment))
    return method.lower() + "".join(pieces)


def tag_for(path):
    for pattern, tag in TAG_RULES:
        if pattern.search(path):
            return tag
    return "Discovery"


def phase_for(tag):
    return TAG_PHASE.get(tag, "setup")


def first_owner(owners):
    """The owner the operation names in `x-mcp-tool`: the shallowest call site."""
    ordered = sorted(enumerate(owners), key=lambda pair: (pair[1].get("depth", 99), pair[0]))
    return ordered[0][1]


def summary_for(tools, tool, branch):
    title = (tools.get(tool) or {}).get("title") or tool
    title = title.rstrip(".")
    branch = (branch or "").strip()
    if not branch:
        return title
    leaf = re.split(r"\s*\|\s*", branch)[0]
    if "." in leaf:
        leaf = leaf.split(".")[-1]
    return f"{title} — {leaf.replace('_', ' ')}"


# ---- server derivation --------------------------------------------------------


def route_key(path):
    """Normalize a route for matching: placeholders collapsed, query dropped."""
    route = re.sub(r"\{[^{}]*\}", "{}", (path or "").split("?")[0])
    route = re.sub(r"<[^>]*>", "{}", route)
    if route.startswith("/v1/"):
        route = route[3:]
    elif route == "/v1":
        route = "/"
    return route


def aliased_route(path):
    """`route_key` with the legacy Rails segments the MCP still calls folded on."""
    route = route_key(path)
    return "/".join(ROUTE_ALIASES.get(segment, segment) for segment in route.split("/"))


def _block_statements(node):
    """Statements of one block, descending into the blocks a route can branch on."""
    for statement in getattr(node, "body", []) or []:
        yield statement
        if isinstance(statement, (ast.If, ast.For, ast.While, ast.With, ast.Try)):
            for field in ("body", "orelse", "finalbody"):
                yield from _block_statements(
                    ast.Module(body=list(getattr(statement, field, []) or []), type_ignores=[])
                )
            for handler in getattr(statement, "handlers", []) or []:
                yield from _block_statements(ast.Module(body=handler.body, type_ignores=[]))


def _route_literals(node, scope):
    """Route literals an expression can produce. An f-string folds to `{}`."""
    if node is None:
        return []
    if isinstance(node, ast.Constant):
        return [node.value] if isinstance(node.value, str) and node.value.startswith("/") else []
    if isinstance(node, ast.JoinedStr):
        text = "".join(
            str(part.value) if isinstance(part, ast.Constant) else "{}" for part in node.values
        )
        return [text] if text.startswith("/") else []
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return [
            left + right
            for left in _route_literals(node.left, scope)
            for right in _route_literals(node.right, scope)
        ]
    if isinstance(node, ast.Name):
        return list(scope.get(node.id) or [])
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        return list(scope.get("#table:" + node.value.id) or [])
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return list(scope.get("#call:" + node.func.id) or [])
    return []


def _scope_literals(node, scope):
    """Local `name = "<route>"` bindings inside one function body."""
    for statement in _block_statements(node):
        if isinstance(statement, ast.Assign):
            values = _route_literals(statement.value, scope)
            for target in statement.targets:
                if isinstance(target, ast.Name) and values:
                    scope[target.id] = values
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
            values = _route_literals(statement.value, scope)
            if values:
                scope[statement.target.id] = values


def _module_route_tables(tree):
    """Module-level `{name: route}` tables, e.g. `_ANALYZE_JOB_ENDPOINTS`."""
    tables = {}
    for node in tree.body:
        name = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
        if name and isinstance(node.value, ast.Dict):
            table = {}
            for key, value in zip(node.value.keys, node.value.values):
                if isinstance(value, ast.Constant) and isinstance(value.value, str) and value.value.startswith("/"):
                    table[key.value if isinstance(key, ast.Constant) else None] = value.value
            if table:
                tables[name] = table
    return tables


def _function_route_literals(tree):
    """`function name -> route literals its body holds`, for route builders."""
    literals = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        found = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Constant) and isinstance(child.value, str) and child.value.startswith("/") and len(child.value) > 1:
                found.add(child.value)
            elif isinstance(child, ast.JoinedStr):
                text = "".join(
                    str(part.value) if isinstance(part, ast.Constant) else "{}" for part in child.values
                )
                if text.startswith("/"):
                    found.add(text)
        literals.setdefault(node.name, set()).update(found)
    return literals


def _branch_handlers(server_tree, families_tree):
    """`(tool, branch) -> handler functions`, read from the MCP's dispatch tables.

    `families.py` FAMILIES owns every action-family branch, `_DISCOVER_DOMAIN_VIEWS`
    owns the gen_discover domain+view matrix, and `_AVATAR_HANDLERS` owns the
    gen_avatars ops.
    """
    handlers = {}
    for tree, wanted in ((server_tree, ("_DISCOVER_DOMAIN_VIEWS", "_AVATAR_HANDLERS")),):
        for node in tree.body:
            name = None
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                name = node.target.id
            if name not in wanted or not isinstance(node.value, ast.Dict):
                continue
            if name == "_DISCOVER_DOMAIN_VIEWS":
                for domain, views in zip(node.value.keys, node.value.values):
                    if not isinstance(domain, ast.Constant) or not isinstance(views, ast.Dict):
                        continue
                    for view, handler in zip(views.keys, views.values):
                        if isinstance(view, ast.Constant) and isinstance(handler, ast.Constant):
                            handlers[("gen_discover", f"{domain.value}.{view.value}")] = [handler.value]
            else:
                for op, handler in zip(node.value.keys, node.value.values):
                    if not isinstance(op, ast.Constant):
                        continue
                    if isinstance(handler, ast.Constant):
                        handlers[("gen_avatars", op.value)] = [handler.value]
                    elif isinstance(handler, ast.Lambda):
                        handlers[("gen_avatars", op.value)] = [
                            call.func.id
                            for call in ast.walk(handler)
                            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                        ]
    for node in families_tree.body:
        name = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
        if name != "FAMILIES" or not isinstance(node.value, (ast.List, ast.Tuple)):
            continue
        for element in node.value.elts:
            if not isinstance(element, ast.Dict):
                continue
            fields = {key.value if isinstance(key, ast.Constant) else None: value for key, value in zip(element.keys, element.values)}
            tool, branches = fields.get("tool"), fields.get("branches")
            if not isinstance(tool, ast.Constant) or not isinstance(branches, ast.Dict):
                continue
            for branch, handler in zip(branches.keys, branches.values):
                if isinstance(branch, ast.Constant) and isinstance(handler, ast.Constant):
                    handlers[(tool.value, branch.value)] = [handler.value]
    return handlers


def derive_servers(entries, mcp_src):
    """`{<METHOD> <path>: (server, source)}` for the surface, read out of the MCP source.

    Four signals are consulted, strongest first, and every operation must land
    on exactly one backend or the derivation fails loudly:

    * the branch's handler function, closed over the call graph to the client
      helper it reaches — the MCP's own dispatch tables say which function a
      `(tool, branch)` runs;
    * a call site whose `(method, route)` matches the operation;
    * a route literal that is an ancestor of the operation's route;
    * the single backend a tool's own handlers all reach.

    `source` is the `file:line (helper)` the host was read from, so the claim is
    checkable against gen-mcp-server without re-running the derivation.
    """
    src_root = os.path.join(mcp_src, "src", "gen_mcp_server")
    if not os.path.isdir(src_root):
        src_root = mcp_src
    repo_prefix = os.path.relpath(src_root, mcp_src).replace(os.sep, "/")
    repo_prefix = "" if repo_prefix == "." else repo_prefix.rstrip("/") + "/"

    module_tables = {}
    function_literals = {}
    function_hosts = {}
    call_edges = {}
    route_hosts = {}
    prefix_hosts = {}
    tool_functions = {}
    wire_calls = []
    servers_tree = None
    families_tree = None
    parsed = []

    for root, _dirs, names in os.walk(src_root):
        for name in sorted(names):
            if not name.endswith(".py"):
                continue
            path = os.path.join(root, name)
            relative = repo_prefix + os.path.relpath(path, src_root).replace(os.sep, "/")
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            try:
                tree = ast.parse(text)
            except SyntaxError:
                continue
            parsed.append((relative, text, tree))
            if name == "server.py":
                servers_tree = tree
            if name == "families.py":
                families_tree = tree
            module_tables.update(_module_route_tables(tree))
            for function, literals in _function_route_literals(tree).items():
                function_literals.setdefault(function, set()).update(literals)

    route_scope = {"#table:" + name: sorted(table.values()) for name, table in module_tables.items()}

    def record_route(route, server, source):
        key = aliased_route(route)
        if not key or not key.startswith("/"):
            return
        table = route_hosts.setdefault(key, {})
        table.setdefault(server, source)
        segments = [segment for segment in key.split("/") if segment]
        for size in range(len(segments), 0, -1):
            prefix = "/" + "/".join(segments[:size])
            prefix_hosts.setdefault(prefix, {}).setdefault(server, source)

    for relative, text, tree in parsed:
        for match in re.finditer(r"https://([a-z0-9.-]+\.gen\.pro)(/[A-Za-z0-9_/{}\-.]*)", text):
            route = match.group(2)
            server = "https://" + match.group(1) + ("/v1" if route.startswith("/v1") else "")
            record_route(route, server, f"{relative} (absolute endpoint URL)")
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                target = decorator.func if isinstance(decorator, ast.Call) else decorator
                deco_name = target.id if isinstance(target, ast.Name) else (target.attr if isinstance(target, ast.Attribute) else None)
                if deco_name not in ("tool", "_served_tool"):
                    continue
                tool_name = node.name
                if isinstance(decorator, ast.Call):
                    for keyword in decorator.keywords:
                        if keyword.arg == "name" and isinstance(keyword.value, ast.Constant):
                            tool_name = keyword.value.value
                    if decorator.args and isinstance(decorator.args[0], ast.Constant):
                        tool_name = decorator.args[0].value
                tool_functions.setdefault(tool_name, set()).add(node.name)

        class Visitor(ast.NodeVisitor):
            def __init__(self):
                self.function = "<module>"
                self.scope = dict(route_scope)

            def visit_FunctionDef(self, node):
                previous_function, previous_scope = self.function, self.scope
                self.function = node.name
                self.scope = dict(route_scope)
                self.scope.update({"#call:" + name: sorted(values) for name, values in function_literals.items()})
                _scope_literals(node, self.scope)
                self.generic_visit(node)
                self.function, self.scope = previous_function, previous_scope

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_Call(self, node):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else (func.attr if isinstance(func, ast.Attribute) else None)
                if name in CALL_SERVER:
                    server = CALL_SERVER[name]
                    function_hosts.setdefault(self.function, {}).setdefault(server, f"{relative}:{node.lineno} ({name})")
                    args = list(node.args)
                    path_arg = None
                    if args:
                        first = args[0].value if isinstance(args[0], ast.Constant) and isinstance(args[0].value, str) else None
                        if first and first.upper() in MCP_METHODS:
                            path_arg = args[1] if len(args) > 1 else None
                        else:
                            path_arg = args[0]
                    for keyword in node.keywords:
                        if keyword.arg in ("path", "route", "url"):
                            path_arg = keyword.value
                    source = f"{relative}:{node.lineno} ({name})"
                    for route in _route_literals(path_arg, self.scope):
                        record_route(route, server, source)
                    if isinstance(path_arg, ast.Call) and isinstance(path_arg.func, ast.Name):
                        helper = path_arg.func.id
                        for route in function_literals.get(helper, ()):
                            record_route(route, server, f"{relative}:{node.lineno} ({name} {helper})")
                        for argument in getattr(path_arg, "args", []) or []:
                            for route in _route_literals(argument, self.scope):
                                record_route(route, server, f"{relative}:{node.lineno} ({name} {helper})")
                if name in ("wire", "pinned_request") and node.args and isinstance(node.args[0], ast.Constant):
                    wire_calls.append((node.args[0].value, f"{relative}:{node.lineno}"))
                if name == "api_call" and node.args and isinstance(node.args[0], ast.Call):
                    contract = node.args[0].func
                    if isinstance(contract, ast.Name) and contract.id == "action_contract":
                        record_route("/vidsheet/actions", API_SERVER, f"{relative}:{node.lineno} (action envelope)")
                if isinstance(func, ast.Name) and name not in CALL_SERVER:
                    call_edges.setdefault(self.function, set()).add(name)
                self.generic_visit(node)

        Visitor().visit(tree)

    changed = True
    while changed:
        changed = False
        for function, callees in call_edges.items():
            table = function_hosts.setdefault(function, {})
            for callee in callees:
                for server, source in (function_hosts.get(callee) or {}).items():
                    if server not in table:
                        table[server] = source
                        changed = True

    # `wire(operation_id)` names a route in the vendored Vidsheet contract, which
    # Rails serves. The two pinned routes are the ones that contract has not
    # published yet (gen-mcp-server vidsheet_contract.PINNED_VIDSHEET_ROUTES).
    contract_path = os.path.join(src_root, "contracts", "vidsheet-operations-schema.json")
    contract_routes = {}
    if os.path.exists(contract_path):
        with open(contract_path, encoding="utf-8") as handle:
            contract = json.load(handle)
        for route, item in contract.get("paths", {}).items():
            for operation in item.values():
                if isinstance(operation, dict) and "operationId" in operation:
                    contract_routes.setdefault(operation["operationId"], []).append(route)
    pinned = {
        "vidsheet.card_from_job": ["/vidsheet/card_from_job"],
        "spreadsheet.generations": ["/vidsheet/{vidsheet_id}/generations"],
    }
    for operation_id, where in wire_calls:
        for route in list(contract_routes.get(operation_id, [])) + pinned.get(operation_id, []):
            record_route(route, API_SERVER, f"{where} (wire {operation_id})")

    handlers = _branch_handlers(servers_tree, families_tree) if servers_tree and families_tree else {}

    def tool_servers(tool):
        merged = {}
        for function in tool_functions.get(tool, ()):
            for server, source in (function_hosts.get(function) or {}).items():
                merged.setdefault(server, source)
        return merged

    def branch_servers(tool, branch):
        if tool == "gen_vidsheet_action":
            # Every gen_vidsheet_action op reaches Rails through the one action
            # envelope, so the tool's own handlers carry the host.
            return tool_servers(tool)
        candidates = []
        if tool == "gen_discover" and "." in branch:
            candidates = handlers.get((tool, branch), [])
        elif tool == "gen_avatars":
            for part in branch.split("|"):
                candidates.extend(handlers.get((tool, part.split(" ")[0].strip()), []))
        else:
            candidates = handlers.get((tool, branch), [])
        merged = {}
        for name in candidates:
            for server, source in (function_hosts.get(name) or {}).items():
                merged.setdefault(server, source)
        return merged

    derived = {}
    unresolved = []
    for entry in entries:
        method, path = entry["method"], entry["path"]
        key = aliased_route(path)
        chosen = None
        branch = branch_servers(entry.get("mcp_tool") or "", entry.get("mcp_branch") or "")
        if len(branch) == 1:
            chosen = next(iter(branch.items()))
        if chosen is None:
            exact = route_hosts.get(key) or {}
            if len(exact) == 1:
                chosen = next(iter(exact.items()))
        if chosen is None:
            best = None
            for prefix, table in prefix_hosts.items():
                if key == prefix or key.startswith(prefix + "/"):
                    if best is None or len(prefix) > len(best[0]):
                        best = (prefix, table)
            if best is not None and len(best[1]) == 1:
                chosen = next(iter(best[1].items()))
        if chosen is None:
            tool = tool_servers(entry.get("mcp_tool") or "")
            if len(tool) == 1:
                chosen = next(iter(tool.items()))
        if chosen is None:
            unresolved.append(f"{method} {path}")
            continue
        derived[f"{method} {path}"] = chosen
    if unresolved:
        raise ValueError("cannot derive a backend for: " + ", ".join(sorted(unresolved)))
    return derived
# ---- surface ------------------------------------------------------------------


def build_surface(coverage, raw, overrides):
    tools = {tool["name"]: tool for tool in read_json(os.path.join(ROOT, "scripts", "backend", "mcp-tools.json"))["tools"]}
    raw_names = raw_param_names(raw)
    entries = []
    seen = set()

    for operation in coverage["operations"]:
        if operation["coverage"] not in ("direct", "envelope"):
            continue
        owners = operation["mcp"]
        if not owners:
            raise ValueError(f"{operation['method']} {operation['path']}: covered with no MCP owner")
        owner = first_owner(owners)
        key = (operation["method"], operation["path"])
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            {
                "method": operation["method"],
                "path": operation["path"],
                "operationId": operation["operationId"],
                "tag": operation["tag"],
                "summary": operation["summary"],
                "mcp_tool": owner["tool"],
                "mcp_branch": owner["branch"],
                "mcp_owners": [{"tool": item["tool"], "branch": item["branch"]} for item in owners],
            }
        )

    for route in coverage["mcp_only_routes"]:
        key = (route["method"], route["path"])
        if key in seen:
            continue
        seen.add(key)
        owner = route["owners"][0]
        pattern = normalize(route["path"])
        needed = route["path"].count("{}")
        if needed == 0:
            names = []
        elif pattern in overrides:
            names = overrides[pattern]
        elif pattern in raw_names and len(raw_names[pattern]) == needed:
            names = raw_names[pattern]
        else:
            raise ValueError(f"{route['method']} {route['path']}: no parameter names (add to scripts/mcp-path-params.json)")
        path = fill_path(route["path"], names)
        entries.append(
            {
                "method": route["method"],
                "path": path,
                "operationId": generate_operation_id(route["method"], path),
                "tag": tag_for(path),
                "summary": summary_for(tools, owner["tool"], owner["branch"]),
                "mcp_tool": owner["tool"],
                "mcp_branch": owner["branch"],
                "mcp_owners": [{"tool": item["tool"], "branch": item["branch"]} for item in route["owners"]],
            }
        )

    entries.sort(key=lambda entry: (entry["path"], METHOD_ORDER.index(entry["method"])))
    ids = [entry["operationId"] for entry in entries]
    if len(set(ids)) != len(ids):
        duplicates = sorted({value for value in ids if ids.count(value) > 1})
        raise ValueError(f"duplicate operationId(s): {duplicates}")
    return entries


METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

KEEP_IDENTIFIERS = {"quote", "quote_path_id", "str", "_sma_id_path", "urlencode", "quote_plus"}


def raw_param_names(raw):
    """`{normalized path: [param names]}` read from the audited call literals."""
    table = {}
    for _key, calls in raw.get("coverage", {}).items():
        for call in calls:
            text = call.get("raw") or ""
            literals = re.findall(r"f'([^']*)'", text) + re.findall(r'f"([^"]*)"', text)
            literals += re.findall(r"'((?:/[^']*\{[^']*))'", text)
            literals += re.findall(r'"((?:/[^"]*\{[^"]*))"', text)
            for literal in literals:
                literal = literal.split("?")[0]
                if "{" not in literal:
                    continue
                names = []
                for match in re.finditer(r"\{([^{}]*)\}", literal):
                    identifiers = [part for part in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", match.group(1)) if part not in KEEP_IDENTIFIERS]
                    names.append(identifiers[-1] if identifiers else None)
                if names and all(names):
                    table.setdefault(normalize(literal), tuple(names))
    return table


# ---- seed ---------------------------------------------------------------------


def is_surface_annotation(line):
    """The annotations this script adds on top of a seed operation."""
    return line.startswith(("      x-mcp-tool:", "      x-mcp-branch:", "      x-schema-status:"))


def extract_seed(source):
    text = read_file(source)
    lines = text.split("\n")
    paths_at = lines.index("paths:")
    components_at = next(i for i, line in enumerate(lines) if line.startswith("components:"))
    body = lines[paths_at + 1:components_at]
    seed = {"paths": []}
    current = None
    current_method = None
    for line in body:
        match = re.match(r"^  (\S.*):\s*$", line)
        if match:
            current = {"path": match.group(1), "header": [], "operations": {}}
            seed["paths"].append(current)
            current_method = None
            continue
        if current is None:
            continue
        match = re.match(r"^    (get|post|put|patch|delete|head|options):\s*$", line)
        if match:
            current_method = match.group(1)
            current["operations"][current_method] = [line]
            continue
        if current_method is None:
            if not line.startswith("  # gen:"):
                current["header"].append(line)
        elif not line.startswith("  # gen:") and not is_surface_annotation(line):
            current["operations"][current_method].append(line)
    # Drop the generated marker comments that used to wrap /creation_card_matrix.
    for entry in seed["paths"]:
        entry["header"] = [line for line in entry["header"] if not line.startswith("  # gen:")]
        for method, block in entry["operations"].items():
            entry["operations"][method] = [line for line in block if not line.startswith("  # gen:")]
    # /creation_card_matrix is no longer part of the MCP surface.
    seed["paths"] = [entry for entry in seed["paths"] if entry["path"] != "/creation_card_matrix"]
    return seed


def render_contract_request_body(schema):
    """One `requestBody:` block for a schema derived from a controller."""
    return [
        "      requestBody:",
        "        required: true",
        "        content:",
        "          application/json:",
        "            schema:",
        *yaml_block(schema, 14),
    ]


def merge_operation_schema(lines, schema_entry):
    """Add the backend-derived request body / success schema to one rendered operation.

    `scripts/operation-schemas.json` is authoritative for the request body: its
    entries are read straight off the controller, so a body it carries replaces
    the seed's hand-written one (which is where a flat shape that no longer
    matches `params.expect(...)` comes from). A success schema is only filled
    when the operation has none: a seeded `$ref` into `components/schemas`
    is the richer contract and is never overwritten. Every property in either
    field is traceable to the backend files its `source` list names.

    An entry may declare where its success body lives with `responseStatus`:
    the default is the operation's 2xx, but a protocol whose success is a
    non-2xx status (x402's 402 quote) names that status explicitly. `noContent`
    and `noRequestBody` carry no schema at all — they assert the backend returns
    no body (or takes none), so nothing is rendered for them.
    """
    if not schema_entry:
        return list(lines)
    out = list(lines)
    schema = schema_entry.get("requestBody")
    if schema is not None:
        existing = next((i for i, line in enumerate(out) if line.startswith("      requestBody:")), None)
        if existing is not None:
            end = next(
                (j for j in range(existing + 1, len(out)) if re.match(r"^      \S", out[j])),
                len(out),
            )
            del out[existing:end]
        at = next((i for i, line in enumerate(out) if line.startswith("      responses:")), len(out))
        out[at:at] = render_contract_request_body(schema)
    response = schema_entry.get("response")
    if response is not None:
        declared = schema_entry.get("responseStatus")
        status = str(declared) if declared is not None else None
        if status is not None:
            success_at = next((i for i, line in enumerate(out) if line.strip() == f"'{status}':"), None)
            if success_at is None:
                responses_at = next((i for i, line in enumerate(out) if line.startswith("      responses:")))
                out[responses_at + 1:responses_at + 1] = [f"        '{status}':", "          description: Success."]
                success_at = responses_at + 1
        else:
            success_at = next((i for i, line in enumerate(out) if re.match(r"^        '2\d\d':\s*$", line)), None)
            if success_at is None:
                responses_at = next((i for i, line in enumerate(out) if line.startswith("      responses:")))
                out[responses_at + 1:responses_at + 1] = ["        '200':", "          description: Success."]
                success_at = responses_at + 1
        end = next(
            (
                j
                for j in range(success_at + 1, len(out))
                if re.match(r"^        '\d", out[j])
                or re.match(r"^      [A-Za-z]", out[j])
                or re.match(r"^  \S", out[j])
            ),
            len(out),
        )
        if not any(re.search(r"schema:|\$ref:", line) for line in out[success_at:end]):
            insert_at = end
            while insert_at > success_at + 1 and not out[insert_at - 1].strip():
                insert_at -= 1
            out[insert_at:insert_at] = [
                "          content:",
                "            application/json:",
                "              schema:",
                *yaml_block(response, 16),
            ]
    return out


# ---- avatar response schemas --------------------------------------------------
#
# The backend's docs/generated/avatars-api-schema.json pins the five
# Avatars::Presenter output shapes (summary, detail, look, talking_loop,
# generating_job). Each /avatars operation's success body is one of them: the
# index list is an array of `summary`, show/create/update/copy return `detail`,
# the look routes return `look` and the talking-loop routes return
# `talking_loop`. The request bodies stay hand-written in
# scripts/avatars-request-bodies.json because the backend generates only the
# presenter output, not the strong-parameter lists of those routes.
AVATAR_RESPONSES = {
    "GET /avatars": ("summary", "list"),
    "GET /avatars/{id}": ("detail", "object"),
    "POST /avatars": ("detail", "object"),
    "PATCH /avatars/{id}": ("detail", "object"),
    "POST /avatars/{id}/copy": ("detail", "object"),
    "POST /avatars/{avatar_id}/looks": ("look", "object"),
    "GET /avatars/{avatar_id}/looks/{id}": ("look", "object"),
    "POST /avatars/{avatar_id}/talking_loops": ("talking_loop", "object"),
    "GET /avatars/{avatar_id}/talking_loops/{id}": ("talking_loop", "object"),
    "POST /avatars/{avatar_id}/looks/{avatar_look_id}/talking_loops": ("talking_loop", "object"),
}


def avatar_schema_entries(avatars, request_bodies):
    """Synthetic `scripts/operation-schemas.json` entries for the /avatars routes.

    The response schemas come from the vendored avatars-api-schema.json; the
    request bodies and the DELETE noContent marker come from the hand-written
    scripts/avatars-request-bodies.json. Keyed `METHOD /path` so they flow
    through `merge_operation_schema` exactly like the other operations.
    """
    entries = {}
    for key, (name, kind) in AVATAR_RESPONSES.items():
        schema = avatars.get(name)
        if schema is None:
            raise SystemExit(
                f"{os.path.relpath(AVATARS_SCHEMA_FILE, ROOT)}: missing {name!r} schema; "
                "re-vendor with scripts/sync-from-backend.mjs --backend <gen-backend-v2>"
            )
        entry = {"response": {"type": "array", "items": schema} if kind == "list" else schema}
        request = request_bodies.get(key)
        if request and request.get("requestBody") is not None:
            entry["requestBody"] = request["requestBody"]
        entries[key] = entry
    if request_bodies.get("DELETE /avatars/{id}", {}).get("noContent"):
        entries["DELETE /avatars/{id}"] = {"noContent": True}
    return entries


def server_override_lines(entry):
    """The operation-level `servers:` block for a non-default backend.

    An operation that omits `servers` inherits the document default
    (`api.gen.pro/v1`), which is only correct for the Rails routes.
    """
    server = entry.get("server") or DEFAULT_SERVER
    if server == DEFAULT_SERVER:
        return []
    return ["      servers:", f"        - url: {server}"]


def strip_server_override(lines):
    """Drop a `servers:` block a seed operation carried, so the derived one wins."""
    out = []
    skipping = False
    for line in lines:
        if line.startswith("      servers:"):
            skipping = True
            continue
        if skipping:
            if line.strip() and not line.startswith("        "):
                skipping = False
            elif not line.strip():
                continue
        if not skipping:
            out.append(line)
    return out


def operation_meta(block):
    text = "\n".join(block)
    has_request_body = bool(re.search(r"^      requestBody:", text, re.M))
    match = re.search(r"^        '2(\d\d)':\s*$", text, re.M)
    has_response_schema = False
    if match:
        status = int("2" + match.group(1))
        rest = text[match.end():]
        following = re.search(r"^        '\d", rest, re.M)
        segment = rest[: following.start()] if following else rest
        has_response_schema = bool(re.search(r"schema:|\$ref:", segment, re.M))
        # 204/205 carry no body by definition: a documented success at one of
        # them is complete without a schema (`head :no_content`).
        if not has_response_schema and status in NO_CONTENT_STATUSES:
            has_response_schema = True
    return has_request_body, has_response_schema


# ---- rendering ----------------------------------------------------------------

def yaml_scalar(value):
    return json.dumps(value, ensure_ascii=False)


def yaml_block(value, indent):
    """Render a JSON-schema fragment as YAML lines at `indent` spaces."""
    pad = " " * indent
    lines = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("$schema", "title") and not isinstance(item, (dict, list)):
                continue
            if isinstance(item, (dict, list)):
                if not item:
                    lines.append(f"{pad}{key}: {'{}' if isinstance(item, dict) else '[]'}")
                else:
                    lines.append(f"{pad}{key}:")
                    lines.extend(yaml_block(item, indent + 2))
            elif item is None:
                lines.append(f"{pad}{key}: null")
            elif isinstance(item, bool):
                lines.append(f"{pad}{key}: {'true' if item else 'false'}")
            elif isinstance(item, (int, float)):
                lines.append(f"{pad}{key}: {item}")
            else:
                lines.append(f"{pad}{key}: {yaml_scalar(item)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                first = True
                for key, sub in item.items():
                    if isinstance(sub, (dict, list)):
                        prefix = f"{pad}- {key}:" if first else f"{pad}  {key}:"
                        lines.append(prefix)
                        lines.extend(yaml_block(sub, indent + 4 if first else indent + 4))
                    else:
                        prefix = f"{pad}- {key}:" if first else f"{pad}  {key}:"
                        rendered = yaml_scalar(sub) if isinstance(sub, str) else sub
                        lines.append(f"{prefix} {rendered}")
                    first = False
                if first:
                    lines.append(f"{pad}- {{}}")
            elif isinstance(item, (dict, list)):
                lines.append(f"{pad}-")
                lines.extend(yaml_block(item, indent + 2))
            else:
                rendered = yaml_scalar(item) if isinstance(item, str) else item
                lines.append(f"{pad}- {rendered}")
    return lines


def contract_index(contract):
    table = {}
    for key, value in contract.get("vidsheet_operations", {}).items():
        method, _, route = key.partition(" ")
        table[f"{method} {normalize(route[3:] if route.startswith('/v1') else route)}"] = value
    return table


def contract_for(index, method, path):
    candidate = f"{method} {normalize(path)}"
    if candidate in index:
        return index[candidate]
    if method == "POST" and path == "/vidsheet/actions":
        return {"action_envelope": True}
    return None


def generated_operation(entry, index, contract):
    method = entry["method"].lower()
    lines = [f"    {method}:"]
    lines.append(f"      operationId: {entry['operationId']}")
    lines.extend(server_override_lines(entry))
    lines.append(f"      x-phase: {phase_for(entry['tag'])}")
    lines.append(f"      summary: {yaml_scalar(entry['summary'])}")
    lines.append(f"      tags: [{entry['tag']}]")
    params = [name for name in re.findall(r"\{(\w+)\}", entry["path"])]
    contract_entry = contract_for(index, entry["method"], entry["path"])
    if params:
        lines.append("      parameters:")
        for name in params:
            lines.append(f"      - name: {name}")
            lines.append("        in: path")
            lines.append("        required: true")
            lines.append("        schema:")
            lines.append("          type: string")
    has_request_body = False
    has_response_schema = False
    if contract_entry and contract_entry.get("action_envelope"):
        projection = contract["actions"]["request_projection"]
        lines.append("      requestBody:")
        lines.append("        required: true")
        lines.append("        content:")
        lines.append("          application/json:")
        lines.append("            schema:")
        lines.extend(yaml_block(projection, 14))
        has_request_body = True
    elif contract_entry and contract_entry.get("requestBody"):
        lines.append("      requestBody:")
        lines.extend(
            render_request_body(contract_entry["requestBody"])
        )
        has_request_body = True
    lines.append("      responses:")
    if contract_entry and contract_entry.get("action_envelope") and contract.get("actions", {}).get("response_schema"):
        lines.append("        '200':")
        lines.append("          description: Action result envelope")
        lines.append("          content:")
        lines.append("            application/json:")
        lines.append("              schema:")
        lines.extend(yaml_block(contract["actions"]["response_schema"], 16))
        has_response_schema = True
    else:
        lines.append("        '200':")
        lines.append("          description: Success.")
    lines.append("        '401':")
    lines.append("          $ref: '#/components/responses/Unauthorized'")
    if params:
        lines.append("        '404':")
        lines.append("          $ref: '#/components/responses/NotFound'")
    lines.append(f"      x-mcp-tool: {entry['mcp_tool']}")
    lines.append(f"      x-mcp-branch: {yaml_scalar(entry['mcp_branch'])}")
    missing = (entry["method"] in WRITE_METHODS and not has_request_body) or not has_response_schema
    if missing:
        lines.append("      x-schema-status: missing")
    return lines, {"has_request_body": has_request_body, "has_response_schema": has_response_schema, "missing": missing}


def render_request_body(request_body):
    lines = []
    if isinstance(request_body, dict) and "content" in request_body:
        if request_body.get("required"):
            lines.append("        required: true")
        lines.append("        content:")
        for media, media_body in request_body["content"].items():
            lines.append(f"          {media}:")
            if "schema" in media_body:
                lines.append("            schema:")
                lines.extend(yaml_block(media_body["schema"], 14))
    return lines


def attach_error_responses(lines, entry):
    """Attach the backend's shared 401 and validation-error responses when absent.

    Every operation documents the auth failure and the validation failure of the
    backend that serves it, so an integrator always sees the error envelope. The
    responses already present (a seeded 401/404 or an inline 422) are kept; only
    the missing ones are appended, so an operation with a richer hand-written
    error keeps it.
    """
    server = entry.get("server") or DEFAULT_SERVER
    resp401, resp422 = ERROR_RESPONSES.get(server, ERROR_RESPONSES[API_SERVER])
    responses_at = next((i for i, line in enumerate(lines) if line.startswith("      responses:")), None)
    if responses_at is None:
        lines.append("      responses:")
        responses_at = len(lines) - 1
    # The responses block ends at the first non-blank line at the operation
    # level (indent <= 6) or shallower: `x-mcp-tool`, the next method, or path.
    end = len(lines)
    for i in range(responses_at + 1, len(lines)):
        stripped = lines[i].lstrip()
        if stripped == "":
            continue
        if len(lines[i]) - len(stripped) <= 6:
            end = i
            break
    block = lines[responses_at:end]
    insert = []
    if not any(line.strip() == "'401':" for line in block):
        insert.extend(["        '401':", f"          $ref: '#/components/responses/{resp401}'"])
    if not any(line.strip() in ("'422':", "'400':") for line in block):
        insert.extend(["        '422':", f"          $ref: '#/components/responses/{resp422}'"])
    if insert:
        at = end
        while at > responses_at + 1 and lines[at - 1].strip() == "":
            at -= 1
        lines[at:at] = insert
    return lines


def seeded_operation(entry, block):
    lines = strip_server_override(list(block))
    has_request_body, has_response_schema = operation_meta(lines)
    missing = (entry["method"] in WRITE_METHODS and not has_request_body) or not has_response_schema
    annotations = [f"      x-mcp-tool: {entry['mcp_tool']}", f"      x-mcp-branch: {yaml_scalar(entry['mcp_branch'])}"]
    if missing:
        annotations.append("      x-schema-status: missing")
    out = []
    for line in lines:
        out.append(line)
        if re.match(r"^      operationId:", line):
            out.extend(server_override_lines(entry))
            out.extend(annotations)
    return out, {"has_request_body": has_request_body, "has_response_schema": has_response_schema, "missing": missing}


def render_paths(surface, seed, contract, schemas=None):
    schemas = schemas or {}
    index = contract_index(contract)
    seed_by_path = {entry["path"]: entry for entry in seed["paths"]}
    by_path = {}
    for entry in surface:
        by_path.setdefault(entry["path"], []).append(entry)
    order = [entry["path"] for entry in seed["paths"] if entry["path"] in by_path]
    order += sorted(path for path in by_path if path not in seed_by_path)
    body = []
    meta = {}
    for path in order:
        entries = sorted(by_path[path], key=lambda item: METHOD_ORDER.index(item["method"]))
        body.append(f"  {path}:")
        seeded = seed_by_path.get(path)
        if seeded and seeded["header"]:
            body.extend(seeded["header"])
        seeded_methods = list(seeded["operations"]) if seeded else []
        ordered = [entry for entry in entries if entry["method"].lower() in seeded_methods]
        ordered += [entry for entry in entries if entry["method"].lower() not in seeded_methods]
        for entry in ordered:
            seed_block = seeded["operations"].get(entry["method"].lower()) if seeded else None
            if seed_block:
                lines, op_meta = seeded_operation(entry, seed_block)
            else:
                lines, op_meta = generated_operation(entry, index, contract)
            schema_entry = schemas.get(f"{entry['method']} {path}")
            lines = merge_operation_schema(lines, schema_entry)
            lines = attach_error_responses(lines, entry)
            has_request_body, has_response_schema = operation_meta(lines)
            if schema_entry:
                # An explicit declaration is authoritative. `noRequestBody`
                # asserts a write takes no body (`head :ok` on path params)
                # and `noContent` that the success has none; `responseStatus`
                # names a success status that is not 2xx (x402's 402 quote).
                if schema_entry.get("noRequestBody"):
                    has_request_body = True
                if schema_entry.get("noContent"):
                    has_response_schema = True
                elif schema_entry.get("responseStatus") is not None and schema_entry.get("response") is not None:
                    has_response_schema = True
            op_meta = {
                "has_request_body": has_request_body,
                "has_response_schema": has_response_schema,
                "missing": (entry["method"] in WRITE_METHODS and not has_request_body) or not has_response_schema,
            }
            if not op_meta["missing"]:
                lines = [line for line in lines if line != "      x-schema-status: missing"]
            meta[(entry["method"], path)] = op_meta
            body.extend(lines)
    return body, meta


def render_endpoints(surface, verbose):
    tools = {}
    for entry in surface:
        tools.setdefault(entry["tag"], []).append(entry)
    lines = []
    for tag in sorted(tools):
        lines.append(f"**{tag}**")
        lines.append("")
        for entry in sorted(tools[tag], key=lambda item: (item["path"], METHOD_ORDER.index(item["method"]))):
            if verbose:
                lines.append(
                    f"- `{entry['method']} /v1{entry['path']}` — MCP `{entry['mcp_tool']}` / `{entry['mcp_branch']}`"
                )
            else:
                lines.append(f"- `{entry['method']} /v1{entry['path']}`")
        lines.append("")
    while lines and lines[-1] == "":
        lines.pop()
    return lines


# ---- file plumbing ------------------------------------------------------------


def read_file(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def write_file(path, text):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def render_paths_file(text, body):
    lines = text.split("\n")
    start = next((i for i, line in enumerate(lines) if PATHS_START in line), -1)
    if start >= 0:
        end = next(i for i, line in enumerate(lines) if i > start and PATHS_END in line)
        head, tail = lines[:start], lines[end + 1:]
    else:
        paths_at = lines.index("paths:")
        components_at = next(i for i, line in enumerate(lines) if line.startswith("components:"))
        head, tail = lines[: paths_at + 1], lines[components_at:]
    block = [
        "  # gen:mcp-surface-paths:start — generated by scripts/sync_mcp_surface.py; do not edit",
        "",
        *body,
        "",
        "  # gen:mcp-surface-paths:end",
    ]
    return "\n".join([*head, *block, *tail])


def render_endpoints_file(text, body):
    start = next((i for i, line in enumerate(text.split("\n")) if f"gen:{ENDPOINTS_TAG}:start" in line), -1)
    lines = text.split("\n")
    if start < 0:
        raise ValueError(f"marker gen:{ENDPOINTS_TAG}:start not found")
    end = next(i for i, line in enumerate(lines) if i > start and f"gen:{ENDPOINTS_TAG}:end" in line)
    return "\n".join(
        lines[: start + 1]
        + ["", *body, ""]
        + lines[end:]
    )


def render_marker_region(text, start_marker, end_marker, body, anchor):
    """Replace a `gen:` marker region, or insert it at `anchor(lines)` once."""
    lines = text.split("\n")
    start = next((i for i, line in enumerate(lines) if start_marker in line), -1)
    if start >= 0:
        end = next(i for i, line in enumerate(lines) if i > start and end_marker in line)
        head, tail = lines[:start], lines[end + 1:]
    else:
        at = anchor(lines)
        head, tail = lines[:at], lines[at:]
    block = [
        f"    # {start_marker} — generated by scripts/sync_mcp_surface.py; do not edit",
        "",
        *body,
        "",
        f"    # {end_marker}",
    ]
    result = "\n".join([*head, *block, *tail])
    if not result.endswith("\n"):
        result += "\n"
    return result


def render_error_envelope_schemas():
    lines = []
    for name, schema in ERROR_ENVELOPE_SCHEMAS.items():
        if lines:
            lines.append("")
        lines.append(f"    {name}:")
        lines.extend(yaml_block(schema, 6))
    return lines


def render_error_envelope_responses():
    lines = []
    for server in TOP_LEVEL_SERVERS:
        resp401, resp422 = ERROR_RESPONSES[server]
        schema = ERROR_RESPONSE_SCHEMA[server]
        for name, description in (
            (resp401, "Missing or invalid authentication."),
            (resp422, "Validation failed or the request could not be processed."),
        ):
            if lines:
                lines.append("")
            lines.append(f"    {name}:")
            lines.append(f"      description: {yaml_scalar(description)}")
            lines.append("      content:")
            lines.append("        application/json:")
            lines.append("          schema:")
            lines.append(f"            $ref: '#/components/schemas/{schema}'")
    return lines


def render_error_components(text):
    text = render_marker_region(
        text,
        ERROR_SCHEMAS_START,
        ERROR_SCHEMAS_END,
        render_error_envelope_schemas(),
        lambda lines: next(i for i, line in enumerate(lines) if line == "  responses:"),
    )
    text = render_marker_region(
        text,
        ERROR_RESPONSES_START,
        ERROR_RESPONSES_END,
        render_error_envelope_responses(),
        lambda lines: len(lines),
    )
    return text


# ---- commands ----------------------------------------------------------------


def render_all(surface, seed, contract, schemas=None):
    body, meta = render_paths(surface, seed, contract, schemas)
    outputs = {}
    for relative in OPENAPI_FILES:
        outputs[relative] = render_error_components(render_paths_file(read_file(os.path.join(ROOT, relative)), body))
    for relative in LLMS_FILES:
        verbose = relative.endswith("llms-full.txt")
        outputs[relative] = render_endpoints_file(read_file(os.path.join(ROOT, relative)), render_endpoints(surface, verbose))
    return outputs, meta


def assert_invariants(surface, meta):
    failures = []
    missing = 0
    for entry in surface:
        op = meta[(entry["method"], entry["path"])]
        if entry["method"] in WRITE_METHODS and not op["has_request_body"] and not op["missing"]:
            failures.append(f"{entry['method']} {entry['path']}: write without requestBody and without x-schema-status")
        if not op["has_response_schema"] and not op["missing"]:
            failures.append(f"{entry['method']} {entry['path']}: no 2xx response schema and no x-schema-status")
        if op["missing"]:
            missing += 1
    return failures, missing


def main(argv):
    options = {"check": False, "init_seed": False, "build_surface": False, "derive_servers": False, "update_baseline": False}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--check":
            options["check"] = True
        elif arg == "--update-baseline":
            options["update_baseline"] = True
        elif arg == "--init-seed":
            options["init_seed"] = True
        elif arg == "--build-surface":
            options["build_surface"] = True
        elif arg == "--derive-servers":
            options["derive_servers"] = True
        elif arg == "--from":
            i += 1
            options["from"] = argv[i]
        elif arg in ("--coverage", "--raw", "--mcp-surface", "--mcp-src"):
            i += 1
            options[arg[2:].replace("-", "_")] = argv[i]
        else:
            raise SystemExit(f"unknown option {arg}")
        i += 1

    if options["init_seed"]:
        if "from" not in options:
            raise SystemExit("--init-seed needs --from <spec.yaml> (the hand-written spec to carry operations from)")
        write_json(SEED_FILE, extract_seed(options["from"]))
        print(f"wrote {os.path.relpath(SEED_FILE, ROOT)}")
        return 0

    if options["derive_servers"]:
        mcp_src = options.get("mcp_src") or os.environ.get("GEN_MCP_PATH")
        if not mcp_src:
            raise SystemExit("--derive-servers needs --mcp-src <gen-mcp-server checkout> or GEN_MCP_PATH")
        document = read_json(SURFACE_FILE)
        derived = derive_servers(document["operations"], mcp_src)
        counts = {}
        for entry in document["operations"]:
            server, source = derived[f"{entry['method']} {entry['path']}"]
            entry["server"] = server
            entry["server_source"] = source
            counts[server] = counts.get(server, 0) + 1
        write_json(SURFACE_FILE, document)
        print(f"wrote {os.path.relpath(SURFACE_FILE, ROOT)} ({len(document['operations'])} operations)")
        for server in TOP_LEVEL_SERVERS:
            print(f"  {server}: {counts.get(server, 0)}")
        return 0

    if options["build_surface"]:
        coverage = read_json(options["coverage"])
        raw = read_json(options["raw"])
        overrides = read_json(OVERRIDES_FILE) if os.path.exists(OVERRIDES_FILE) else {}
        entries = build_surface(coverage, raw, overrides)
        write_json(SURFACE_FILE, {"source": "api-mcp-coverage.json (MCP tool → backend route)", "operations": entries})
        print(f"wrote {os.path.relpath(SURFACE_FILE, ROOT)} ({len(entries)} operations)")
        return 0

    surface = read_json(options.get("mcp_surface", SURFACE_FILE))["operations"]
    unhosted = sorted(
        f"{entry['method']} {entry['path']}" for entry in surface if entry.get("server") not in TOP_LEVEL_SERVERS
    )
    if unhosted:
        print("FAIL: surface operations with no known `server` (run --derive-servers):")
        for key in unhosted:
            print(f"  {key}")
        return 1
    seed = read_json(SEED_FILE)
    contract = read_json(CONTRACT_FILE)
    schemas = read_json(SCHEMAS_FILE) if os.path.exists(SCHEMAS_FILE) else {}
    known = {f"{entry['method']} {entry['path']}" for entry in surface}
    unknown = sorted(set(schemas) - known)
    if unknown:
        print("FAIL: scripts/operation-schemas.json has keys that are not MCP-surface operations:")
        for key in unknown:
            print(f"  {key}")
        return 1
    # The /avatars response schemas come from the vendored avatars-api-schema.json,
    # not from scripts/operation-schemas.json. Fail loudly when the vendored file
    # is missing so a regression never silently drops those response schemas.
    if not os.path.exists(AVATARS_SCHEMA_FILE):
        print(
            f"FAIL: {os.path.relpath(AVATARS_SCHEMA_FILE, ROOT)} is missing; "
            "run scripts/sync-from-backend.mjs --backend <gen-backend-v2> to vendor it"
        )
        return 1
    avatars = read_json(AVATARS_SCHEMA_FILE)
    request_bodies = read_json(AVATAR_REQUEST_BODIES_FILE) if os.path.exists(AVATAR_REQUEST_BODIES_FILE) else {}
    schemas.update(avatar_schema_entries(avatars, request_bodies))
    outputs, meta = render_all(surface, seed, contract, schemas)
    failures, missing = assert_invariants(surface, meta)
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    if options["update_baseline"]:
        write_json(
            BASELINE_FILE,
            {
                "missing": missing,
                "note": (
                    "Operations in the MCP surface with no full schema in the vendored backend contracts "
                    "or scripts/operation-schemas.json: path parameters only, with `x-schema-status: missing`. "
                    "The count may shrink freely; it may only grow with an explicit contract addition."
                ),
            },
        )
        print(f"wrote {os.path.relpath(BASELINE_FILE, ROOT)} ({missing} missing)")
        return 0
    baseline = read_json(BASELINE_FILE)["missing"]
    if missing > baseline:
        print(f"FAIL: x-schema-status: missing grew to {missing} (baseline {baseline})")
        return 1

    if options["check"]:
        changed = [relative for relative, text in outputs.items() if text != read_file(os.path.join(ROOT, relative))]
        if changed:
            print("FAIL: generated MCP-surface regions differ from the committed docs:")
            for relative in changed:
                print(f"  {relative}")
            print("run: python3 scripts/sync_mcp_surface.py  and commit the result")
            return 1
        print(f"PASS: MCP surface ({len(surface)} operations, {missing} x-schema-status: missing) matches the committed docs")
        return 0

    changed = []
    for relative, text in outputs.items():
        path = os.path.join(ROOT, relative)
        if text != read_file(path):
            write_file(path, text)
            changed.append(relative)
    print(f"regenerated: {', '.join(changed) if changed else 'no change'} ({missing} x-schema-status: missing)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
