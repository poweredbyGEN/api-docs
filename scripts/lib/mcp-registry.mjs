// GEN-10512: the canonical served-tool registry reader shared by the offline MCP
// snapshot generator (scripts/update-mcp-tools-snapshot.mjs) and the backend
// contract sync (scripts/sync-from-backend.mjs). Both consumers resolve the
// served surface from the same schema-paths.tsv tool roots, so the docs snapshot
// and the vendored copy cannot disagree about which tools the MCP server serves.

export const MCP_REGISTRY_PATH = "src/gen_mcp_server/contracts/catalog-record/schema-paths.tsv";

// The docs read the served surface from this registry, so fewer roots than the
// tool minimum means a truncated upstream artifact, not a smaller surface.
export const MIN_SERVED_TOOLS = 10;

const REQUIRED_COLUMNS = ["record", "row_type", "pointer", "description", "title"];

// A minimal reader for the registry's TSV shape: a comment preamble, then one
// header row starting with `record_kind`, then one row per JSON pointer. A
// missing header or required column raises instead of yielding an empty surface.
export function parseRegistryTsv(registry) {
  const lines = registry.split("\n").map((line) => line.replace(/\r$/, ""));
  const headerAt = lines.findIndex((line) => line.startsWith("record_kind\t"));
  if (headerAt < 0) throw new Error("mcp registry: no header row");
  const header = lines[headerAt].split("\t");
  const column = (name) => header.indexOf(name);
  const indexes = {};
  for (const name of REQUIRED_COLUMNS) {
    indexes[name] = column(name);
    if (indexes[name] < 0) throw new Error(`mcp registry: missing required column ${name}`);
  }
  const rows = [];
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    rows.push({ cells: line.split("\t"), ...indexes });
  }
  return rows;
}

// The served tools are the registry's tool roots: the `tool_field` row whose
// pointer is empty. A nested field row describes a property, not a tool.
export function servedTools(registry) {
  const tools = parseRegistryTsv(registry)
    .filter((row) => row.cells[row.row_type] === "tool_field" && (row.cells[row.pointer] ?? "") === "")
    .map((row) => ({
      name: row.cells[row.record] ?? "",
      title: row.cells[row.title] ?? "",
      description: row.cells[row.description] ?? "",
    }))
    .filter((tool) => tool.name.startsWith("gen_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (tools.length < MIN_SERVED_TOOLS) throw new Error(`mcp registry: only ${tools.length} served tools`);
  return tools;
}
