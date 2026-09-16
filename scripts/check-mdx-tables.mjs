// A `|` inside a code span in a Markdown table row ends the cell, and the
// leftover text is then parsed as a JSX expression — so `{ a: 'x' | 'y' }`
// fails the Astro build with "Could not parse expression with acorn", far from
// the line that caused it. Escape it as `\|`. Run: npm test
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );

const errors = [];
for (const file of walk("src/content/docs")) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trimStart().startsWith("|")) return;
    for (const [, code] of line.matchAll(/`([^`]*)`/g)) {
      if (code.includes("|") && !code.includes("\\|")) {
        errors.push(`${file}:${i + 1}: unescaped | inside a table code span -> ${code.slice(0, 60)}`);
      }
    }
  });
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("mdx tables OK");
