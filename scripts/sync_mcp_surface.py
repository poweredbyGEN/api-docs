#!/usr/bin/env python3
"""Generate the public docs' MCP surface.

MCP is GEN's public contract, so `public/openapi.yaml` documents exactly the
backend routes an MCP tool calls: nothing more, nothing less. This script owns
two generated regions:

  public/openapi.yaml          the whole `paths:` body, between the
  public/.well-known/openapi.yaml
                               `gen:mcp-surface-paths` markers
  public/llms.txt              the endpoint list, between the
  public/llms-full.txt         `gen:mcp-surface-endpoints` markers

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
* otherwise the operation is emitted with `x-schema-status: missing` and its
  path parameters only. No field is ever invented.

Usage:
  python3 scripts/sync_mcp_surface.py                       # regenerate
  python3 scripts/sync_mcp_surface.py --check               # CI gate
  python3 scripts/sync_mcp_surface.py --init-seed --from <spec.yaml>   # re-seed
  python3 scripts/sync_mcp_surface.py --build-surface \\
      --coverage <api-mcp-coverage.json> --raw <final_raw.json>
  python3 scripts/sync_mcp_surface.py --check --mcp-surface <surface.json>

`--check` re-renders from the committed inputs and exits 1 when a target
differs, when a write lacks a request body or an operation lacks a 2xx response
schema without carrying `x-schema-status: missing`, or when the missing count
grows past `scripts/openapi-missing-baseline.json`.
"""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURFACE_FILE = os.path.join(ROOT, "scripts", "mcp-surface.json")
SEED_FILE = os.path.join(ROOT, "scripts", "openapi-operations.json")
BASELINE_FILE = os.path.join(ROOT, "scripts", "openapi-missing-baseline.json")
CONTRACT_FILE = os.path.join(ROOT, "scripts", "backend", "public-contract.json")
OVERRIDES_FILE = os.path.join(ROOT, "scripts", "mcp-path-params.json")
OPENAPI_FILES = ["public/openapi.yaml", "public/.well-known/openapi.yaml"]
LLMS_FILES = ["public/llms.txt", "public/llms-full.txt"]
METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
WRITE_METHODS = ("POST", "PUT", "PATCH")

PATHS_START = "gen:mcp-surface-paths:start"
PATHS_END = "gen:mcp-surface-paths:end"
ENDPOINTS_TAG = "mcp-surface-endpoints"

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


def operation_meta(block):
    text = "\n".join(block)
    has_request_body = bool(re.search(r"^      requestBody:", text, re.M))
    match = re.search(r"^        '2\d\d':\s*$", text, re.M)
    has_response_schema = False
    if match:
        rest = text[match.end():]
        following = re.search(r"^        '\d", rest, re.M)
        segment = rest[: following.start()] if following else rest
        has_response_schema = bool(re.search(r"schema:|\$ref:", segment, re.M))
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


def seeded_operation(entry, block):
    lines = list(block)
    has_request_body, has_response_schema = operation_meta(lines)
    missing = (entry["method"] in WRITE_METHODS and not has_request_body) or not has_response_schema
    annotations = [f"      x-mcp-tool: {entry['mcp_tool']}", f"      x-mcp-branch: {yaml_scalar(entry['mcp_branch'])}"]
    if missing:
        annotations.append("      x-schema-status: missing")
    out = []
    for line in lines:
        out.append(line)
        if re.match(r"^      operationId:", line):
            out.extend(annotations)
    return out, {"has_request_body": has_request_body, "has_response_schema": has_response_schema, "missing": missing}


def render_paths(surface, seed, contract):
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


# ---- commands ----------------------------------------------------------------


def render_all(surface, seed, contract):
    body, meta = render_paths(surface, seed, contract)
    outputs = {}
    for relative in OPENAPI_FILES:
        outputs[relative] = render_paths_file(read_file(os.path.join(ROOT, relative)), body)
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
    options = {"check": False, "init_seed": False, "build_surface": False, "update_baseline": False}
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
        elif arg == "--from":
            i += 1
            options["from"] = argv[i]
        elif arg in ("--coverage", "--raw", "--mcp-surface"):
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

    if options["build_surface"]:
        coverage = read_json(options["coverage"])
        raw = read_json(options["raw"])
        overrides = read_json(OVERRIDES_FILE) if os.path.exists(OVERRIDES_FILE) else {}
        entries = build_surface(coverage, raw, overrides)
        write_json(SURFACE_FILE, {"source": "api-mcp-coverage.json (MCP tool → backend route)", "operations": entries})
        print(f"wrote {os.path.relpath(SURFACE_FILE, ROOT)} ({len(entries)} operations)")
        return 0

    surface = read_json(options.get("mcp_surface", SURFACE_FILE))["operations"]
    seed = read_json(SEED_FILE)
    contract = read_json(CONTRACT_FILE)
    outputs, meta = render_all(surface, seed, contract)
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
                    "Operations in the MCP surface with no full schema in the vendored backend contracts: "
                    "path parameters only, with x-schema-status: missing. The count may shrink freely; it may "
                    "only grow with an explicit contract addition."
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
