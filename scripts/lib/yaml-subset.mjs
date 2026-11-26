// The reader the backend contract sync (scripts/sync-from-backend.mjs) uses for
// config/creation_cards.yml. It lives in its own module so tests import it
// directly and the sync script runs main() unconditionally: a path-equality
// "is this the entry point" guard skips the whole sync silently when the script
// is started through a symlinked path.

// A minimal reader for the YAML shape config/creation_cards.yml uses: block
// mappings, block sequences (indented or at their key's indent) of scalars or of
// block mappings, flow sequences, flow mappings ({k: v}) and scalars. It is not a
// general YAML parser. A construct outside that shape raises rather than being
// guessed at, so an upstream reformat is loud: a bare `-` item, block scalars
// (`|`, `>`), multi-line scalars, and a sibling line at an indent no open block
// owns all end in `unread line` or `not a mapping entry`.
export function parseYamlSubset(text) {
  const tokens = [];
  for (const raw of text.split("\n")) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    tokens.push({ indent: line.match(/^ */)[0].length, content: line.trim() });
  }
  let i = 0;
  const parseBlock = (indent) => (tokens[i].content.startsWith("- ") ? parseSeq(indent) : parseMap(indent));
  const parseMap = (indent) => {
    const out = {};
    while (i < tokens.length && tokens[i].indent === indent && !tokens[i].content.startsWith("- ")) {
      const token = tokens[i];
      const colon = splitKey(token.content);
      if (colon === null) throw new Error(`creation_cards.yml: not a mapping entry: ${token.content}`);
      const { key, rest } = colon;
      i += 1;
      if (rest !== "") out[key] = parseScalar(rest);
      else if (i < tokens.length && tokens[i].indent > indent) out[key] = parseBlock(tokens[i].indent);
      // YAML lets a block sequence sit at the same indent as its key (`job_types:` then
      // `- x` one level in the file's own style); the backend writes cards that way, so
      // read it as that key's value instead of stopping and leaving the items unread.
      else if (i < tokens.length && tokens[i].indent === indent && tokens[i].content.startsWith("- ")) out[key] = parseSeq(indent);
      else out[key] = null;
    }
    return out;
  };
  const parseSeq = (indent) => {
    const out = [];
    while (i < tokens.length && tokens[i].indent === indent && tokens[i].content.startsWith("- ")) {
      const item = tokens[i].content.slice(2).trim();
      if (!item.startsWith("{") && splitKey(item) !== null) {
        // `- key: v` opens a block mapping whose remaining keys sit under the first key,
        // two columns past the dash; re-read the item line as that mapping's first entry.
        // The item line is rewritten in place as that mapping's first token so
        // parseMap reads it like any other key line at the item's column.
        const rest = tokens[i].content.slice(2);
        const column = indent + 2 + (rest.length - rest.trimStart().length);
        tokens[i] = { indent: column, content: item };
        out.push(parseMap(column));
        continue;
      }
      out.push(parseScalar(item));
      i += 1;
    }
    return out;
  };
  const value = parseBlock(tokens[0].indent);
  if (i !== tokens.length) throw new Error(`creation_cards.yml: unread line: ${tokens[i].content}`);
  return value;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i);
  }
  return line;
}

function splitKey(content) {
  let quote = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ":" && (i + 1 === content.length || content[i + 1] === " ")) {
      return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() };
    }
  }
  return null;
}

function parseScalar(value) {
  if (value === "" || value === "~" || value === "null") return null;
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (value.startsWith("[")) return splitFlow(value.slice(1, -1)).map(parseScalar);
  if (value.startsWith("{") && value.endsWith("}")) {
    // A flow mapping, e.g. a talking loop's default clip {prompt: "...", duration: 10}.
    return Object.fromEntries(
      splitFlow(value.slice(1, -1)).map((entry) => {
        const pair = splitKey(entry);
        if (pair === null) throw new Error(`creation_cards.yml: not a flow-mapping entry: ${entry}`);
        return [pair.key, parseScalar(pair.rest)];
      }),
    );
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d*\.\d+$/.test(value)) return Number(value);
  return value;
}

function splitFlow(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) out.push(body.slice(start).trim());
  return out;
}
