"""Independent frozen cases for MCP endpoint provenance determinism (GEN-10598).

# intent: GEN-10598 — `derive_servers` must pick the same server and the same
# `server_source` callsite for identical source bytes, whatever hash seed or
# directory enumeration order the process happens to get. These cases pin the
# current evidence tiers (branch handler, exact route, longest route prefix,
# unique tool backend), the direct-before-inherited source rule, and the
# existing loud refusal when the evidence does not resolve. They run the real
# `derive_servers` and the real `--derive-servers` CLI on generated fixtures;
# they never re-implement the parser.

The rule for the whole file: identical bytes and identical evidence must give
one stable callsite. Ordering may only break ties *within* one evidence tier
(sorted relative path, then sorted function name), never across tiers, and it
may never turn two conflicting backends into an arbitrary success.

Expected source strings are relative to the fixture's MCP source root, exist in
the generated tree, and name the exact callsite line.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "sync_mcp_surface.py"

API_SERVER = "https://api.gen.pro/v1"
AGENT_SERVER = "https://agent.gen.pro/v1"

# The real module, loaded the same way tests/test_mcp_surface.py loads it, so a
# direct-call case exercises the shipped derivation and not a copy of it.
def load_module():
    spec = importlib.util.spec_from_file_location("sync_mcp_surface", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# One subprocess harness for both invocation styles: the seeds case and the
# reversed-enumeration case must run the actual module in a fresh interpreter
# (a hash seed only applies at interpreter start). The reversed walk mutates the
# directory list `os.walk` hands back, which is exactly the ordering freedom the
# derivation has to be immune to.
HARNESS = '''\
import importlib.util
import json
import os
import sys

script, mcp_src, entries_path, reverse = sys.argv[1:5]

if reverse == "1":
    forward_walk = os.walk

    def reversed_walk(top, *args, **kwargs):
        for root, dirs, names in forward_walk(top, *args, **kwargs):
            dirs[:] = list(reversed(dirs))
            names[:] = list(reversed(names))
            yield root, dirs, names

    os.walk = reversed_walk

spec = importlib.util.spec_from_file_location("sync_mcp_surface", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with open(entries_path, encoding="utf-8") as handle:
    entries = json.load(handle)
print(json.dumps(module.derive_servers(entries, mcp_src), sort_keys=True))
'''

# A subprocess that opens a socket fails loudly, so "zero network calls" is a
# property of the run and not a promise in a comment.
SITECUSTOMIZE = '''\
import socket


def _blocked(*args, **kwargs):
    raise AssertionError("provenance generation must not open a network socket")


socket.socket.connect = _blocked
socket.create_connection = _blocked
'''


def write_tree(root, files):
    """Create the fixture files byte for byte; return `{relative path: bytes}`."""
    written = {}
    for relative, text in files.items():
        target = Path(root) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
        written[relative] = text.encode("utf-8")
    return written


def read_tree(root, relatives):
    return {relative: (Path(root) / relative).read_bytes() for relative in relatives}


def offline_env(base=None, hash_seed=None):
    """Env that blocks network and, when asked, pins the interpreter hash seed."""
    env = dict(base or os.environ)
    proxy_dir = Path(env["GEN_10598_OFFLINE_DIR"])
    env["PYTHONPATH"] = str(proxy_dir) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    if hash_seed is not None:
        env["PYTHONHASHSEED"] = str(hash_seed)
    return env


def make_offline_dir(tmp_path):
    offline = Path(tmp_path) / "offline"
    offline.mkdir(exist_ok=True)
    (offline / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
    return offline


def derive_in_subprocess(tmp_path, files, entries, hash_seed=0, reverse_walk=False):
    """Run the real `derive_servers` in a fresh interpreter; return its mapping."""
    tmp_path = Path(tmp_path)
    mcp_src = tmp_path / "mcp"
    mcp_src.mkdir(parents=True)
    write_tree(mcp_src, files)
    entries_path = tmp_path / "entries.json"
    entries_path.write_text(json.dumps(entries), encoding="utf-8")
    harness = tmp_path / "harness.py"
    harness.write_text(HARNESS, encoding="utf-8")
    offline = make_offline_dir(tmp_path)
    env = offline_env({"GEN_10598_OFFLINE_DIR": str(offline)}, hash_seed)
    result = subprocess.run(
        [sys.executable, str(harness), str(SCRIPT), str(mcp_src), str(entries_path), "1" if reverse_walk else "0"],
        capture_output=True,
        text=True,
        env=env,
    )
    # A setup failure is not a case failure: surface it outside the marker.
    if result.returncode != 0:
        raise RuntimeError(f"derive_servers subprocess failed:\n{result.stderr}")
    return json.loads(result.stdout)


def cli_workspace(tmp_path, document):
    """An isolated copy of the real generator next to its own surface document.

    `--derive-servers` reads `scripts/mcp-surface.json` beside the script, so the
    copy is how a case runs the real CLI without touching the committed document.
    """
    tmp_path = Path(tmp_path)
    scripts = tmp_path / "scripts"
    scripts.mkdir(parents=True)
    shutil.copyfile(SCRIPT, scripts / "sync_mcp_surface.py")
    surface = scripts / "mcp-surface.json"
    surface.write_text(json.dumps(document, indent=2), encoding="utf-8")
    return scripts / "sync_mcp_surface.py", surface


def run_cli(tmp_path, script, surface, files, hash_seed=0):
    tmp_path = Path(tmp_path)
    mcp_src = tmp_path / "cli-mcp"
    if mcp_src.exists():
        shutil.rmtree(mcp_src)
    mcp_src.mkdir(parents=True)
    write_tree(mcp_src, files)
    offline = make_offline_dir(tmp_path)
    env = offline_env({"GEN_10598_OFFLINE_DIR": str(offline)}, hash_seed)
    before = surface.read_bytes()
    result = subprocess.run(
        [sys.executable, str(script), "--derive-servers", "--mcp-src", str(mcp_src)],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(tmp_path),
    )
    after = surface.read_bytes()
    return result, before, after


def operations(document):
    return {f"{entry['method']} {entry['path']}": (entry["server"], entry["server_source"]) for entry in document["operations"]}


# T1 fixture: the tool's dispatch table names one handler, and that handler
# reaches the same route through two same-host callsites in a.py and z.py. Both
# callsites are equally valid candidates, so only a stable traversal can pick
# one of them reproducibly.
T1_FILES = {
    "server.py": '_AVATAR_HANDLERS = {"run": "handler"}\n',
    "families.py": "FAMILIES = []\n",
    "a.py": 'def alpha():\n    api_call("GET", "/things")\n',
    "z.py": 'def zeta():\n    api_call("GET", "/things")\n',
    "handler.py": "def handler():\n    alpha()\n    zeta()\n",
}
T1_ENTRIES = [{"method": "GET", "path": "/things", "mcp_tool": "gen_avatars", "mcp_branch": "run"}]


def test_t1_hash_seeds_choose_the_same_callsite(tmp_path):
    mappings = [derive_in_subprocess(tmp_path / f"seed-{seed}", T1_FILES, T1_ENTRIES, hash_seed=seed) for seed in (1, 2, 3, 4)]
    for mapping in mappings[1:]:
        assert mapping == mappings[0]
    # Rails host unchanged, and the tie is broken inside the branch tier by the
    # sorted relative path, never by set order.
    assert mappings[0] == {"GET /things": [API_SERVER, "a.py:2 (api_call)"]}


# T2 fixture: the same two callsites under nested directories, so the exact
# route tier sees two equally valid sources and directory enumeration order
# decides the winner unless the walk is ordered.
T2_FILES = {
    "alpha/a.py": 'def alpha():\n    api_call("GET", "/things")\n',
    "zeta/z.py": 'def zeta():\n    api_call("GET", "/things")\n',
}
T2_ENTRIES = [{"method": "GET", "path": "/things"}]


def test_t2_directory_enumeration_order_does_not_change_output(tmp_path):
    forward = derive_in_subprocess(tmp_path / "forward", T2_FILES, T2_ENTRIES, reverse_walk=False)
    reverse = derive_in_subprocess(tmp_path / "reverse", T2_FILES, T2_ENTRIES, reverse_walk=True)
    assert forward == reverse
    assert forward == {"GET /things": [API_SERVER, "alpha/a.py:2 (api_call)"]}
    # The two runs only read their fixtures.
    assert read_tree(tmp_path / "forward" / "mcp", T2_FILES) == {key: value.encode("utf-8") for key, value in T2_FILES.items()}


def test_t3_direct_source_and_branch_tier_keep_precedence(tmp_path):
    # A handler that calls the backend itself and also calls a helper that does:
    # the direct callsite is the evidence, the inherited one never overrides it.
    direct_files = {
        "server.py": '_AVATAR_HANDLERS = {"run": "handler"}\n',
        "families.py": "FAMILIES = []\n",
        "z_rails.py": 'def helper():\n    api_call("GET", "/items")\n',
        "handler.py": 'def handler():\n    api_call("GET", "/items")\n    helper()\n',
    }
    entries = [{"method": "GET", "path": "/items", "mcp_tool": "gen_avatars", "mcp_branch": "run"}]
    for name, reverse_walk in (("flat", False), ("reversed", True)):
        # intent: GEN-10598 — direct-before-inherited is existing policy and must survive ordering.
        assert derive_in_subprocess(tmp_path / "direct" / name, direct_files, entries, reverse_walk=reverse_walk) == {
            "GET /items": [API_SERVER, "handler.py:2 (api_call)"]
        }

    # A branch handler on Rails wins over a lower, exact-route agent callsite.
    # The agent callsite's path sorts first, so a global "first candidate wins"
    # ordering would silently move the operation to the wrong backend.
    tier_files = {
        "server.py": '_AVATAR_HANDLERS = {"run": "handler"}\n',
        "families.py": "FAMILIES = []\n",
        "a_agent.py": 'def agent_items():\n    agent_api_call("GET", "/items")\n',
        "z_rails.py": 'def handler():\n    api_call("GET", "/items")\n',
    }
    for name, reverse_walk in (("flat", False), ("reversed", True)):
        # intent: GEN-10598 — branch handler outranks exact route; ordering never crosses tiers.
        assert derive_in_subprocess(tmp_path / "tier" / name, tier_files, entries, reverse_walk=reverse_walk) == {
            "GET /items": [API_SERVER, "z_rails.py:2 (api_call)"]
        }


def test_t4_unresolved_operation_still_refuses_at_cli(tmp_path):
    script, surface = cli_workspace(tmp_path, {"operations": [{"method": "GET", "path": "/unknown"}]})
    result, before, after = run_cli(tmp_path, script, surface, {"empty.py": "X = 1\n"})
    assert result.returncode != 0
    assert "cannot derive a backend for: GET /unknown" in result.stderr
    # intent: GEN-10598 — no invented server and no partial document write.
    assert after == before


def test_t5_conflicting_hosts_on_one_route_still_refuse_at_cli(tmp_path):
    # Two backends reach the same route and no stronger tier resolves it: every
    # existing fallback tier is ambiguous, so the refusal must stay. Pinning
    # either host here would be a new, stricter policy.
    script, surface = cli_workspace(tmp_path, {"operations": [{"method": "GET", "path": "/dupe"}]})
    files = {
        "client_api.py": 'def a():\n    api_call("GET", "/dupe")\n',
        "client_agent.py": 'def b():\n    agent_api_call("GET", "/dupe")\n',
    }
    result, before, after = run_cli(tmp_path, script, surface, files)
    assert result.returncode != 0
    assert "cannot derive a backend for: GET /dupe" in result.stderr
    assert after == before

    module = load_module()
    with pytest.raises(ValueError) as raised:
        module.derive_servers([{"method": "GET", "path": "/dupe"}], str(tmp_path / "cli-mcp"))
    assert str(raised.value) == "cannot derive a backend for: GET /dupe"


def test_t6_repeated_cli_is_byte_identical_and_tracks_a_real_host_change(tmp_path):
    document = {
        "operations": [
            {
                "method": "POST",
                "path": "/claims",
                "mcp_tool": "",
                "mcp_branch": "",
                "server": AGENT_SERVER,
                "server_source": "stale.py:1 (stale)",
            }
        ]
    }
    rails_files = {"calls.py": 'def create():\n    api_call("POST", "/claims", json={})\n'}

    script, surface = cli_workspace(tmp_path, document)
    first, _, after_first = run_cli(tmp_path, script, surface, rails_files)
    assert first.returncode == 0, first.stderr
    second, _, after_second = run_cli(tmp_path, script, surface, rails_files)
    assert second.returncode == 0, second.stderr
    # intent: GEN-10598 — repeated generation adds no provenance-only diff.
    assert after_second == after_first

    derived = operations(json.loads(after_second.decode("utf-8")))
    assert derived == {"POST /claims": (API_SERVER, "calls.py:2 (api_call)")}
    source_path = derived["POST /claims"][1].split(":")[0]
    assert (Path(tmp_path) / "cli-mcp" / source_path).exists()
    assert not os.path.isabs(source_path)
    text = after_second.decode("utf-8")
    # Public output stays a relative callsite reference: no fixture path, no
    # source body, no credential-shaped field.
    assert str(tmp_path) not in text
    assert "def create" not in text
    assert not any(word in text.lower() for word in ("secret", "password", "bearer "))

    # The same fixture with the callsite moved to the agent backend must move
    # the derived host: determinism never freezes a stale mapping.
    changed_files = {"calls.py": 'def create():\n    agent_api_call("POST", "/claims", json={})\n'}
    changed, _, after_changed = run_cli(tmp_path, script, surface, changed_files)
    assert changed.returncode == 0, changed.stderr
    assert operations(json.loads(after_changed.decode("utf-8"))) == {
        "POST /claims": (AGENT_SERVER, "calls.py:2 (agent_api_call)")
    }


def test_single_source_control(tmp_path):
    files = {"c.py": 'def only():\n    form_call("POST", "/one")\n'}
    entries = [{"method": "POST", "path": "/one"}]
    for name, reverse_walk in (("flat", False), ("reversed", True)):
        assert derive_in_subprocess(tmp_path / name, files, entries, reverse_walk=reverse_walk) == {
            "POST /one": [API_SERVER, "c.py:2 (form_call)"]
        }


def test_cycle_call_graph_control(tmp_path):
    files = {
        "server.py": '_AVATAR_HANDLERS = {"run": "handler"}\n',
        "families.py": "FAMILIES = []\n",
        "cyc.py": 'def a():\n    b()\n\n\ndef b():\n    a()\n    api_call("GET", "/loop")\n',
        "handler2.py": "def handler():\n    a()\n",
    }
    entries = [{"method": "GET", "path": "/loop", "mcp_tool": "gen_avatars", "mcp_branch": "run"}]
    for name, reverse_walk in (("flat", False), ("reversed", True)):
        assert derive_in_subprocess(tmp_path / name, files, entries, reverse_walk=reverse_walk) == {
            "GET /loop": [API_SERVER, "cyc.py:7 (api_call)"]
        }
