import type { APIRoute, GetStaticPaths } from 'astro';

// Use Vite's import.meta.glob to read all doc files as raw strings at build time.
// This works reliably in both dev and build because Vite resolves these at compile time.
const rawDocs = import.meta.glob<string>('../content/docs/**/*.{mdx,md}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Build a map of slug → raw content
interface DocEntry {
  slug: string;
  raw: string;
}

const docs: DocEntry[] = [];

for (const [path, raw] of Object.entries(rawDocs)) {
  // path looks like: ../content/docs/guides/quickstart.mdx
  // Strip the prefix and extension to get the slug
  const relative = path.replace('../content/docs/', '').replace(/\.mdx?$/, '');
  // index files map to their parent directory (or root "index")
  const slug = relative.endsWith('/index')
    ? relative.replace(/\/index$/, '') || 'index'
    : relative === 'index'
      ? 'index'
      : relative;
  docs.push({ slug, raw });
}

export const getStaticPaths: GetStaticPaths = async () => {
  return docs.map(({ slug }) => ({
    params: { slug },
  }));
};

/**
 * Strip frontmatter (---...---) from markdown content.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (match) {
    return content.slice(match[0].length);
  }
  return content;
}

/**
 * Strip MDX import statements (import { ... } from '...';)
 */
function stripImports(content: string): string {
  return content.replace(/^import\s+.*?;\s*$/gm, '');
}

/**
 * Convert Starlight JSX components to plain markdown equivalents.
 * - <Aside> / <Aside type="tip"> → > **Note:** blockquote
 * - <Steps> → leave numbered list content as-is
 * - <Card>, <CardGrid>, <LinkCard> → strip tags, keep content
 * - <Tabs> / <TabItem> → strip tags, keep content with headers
 */
function convertComponents(content: string): string {
  // Convert LinkCard to markdown link BEFORE stripping tags
  content = content.replace(
    /<LinkCard\s+[^>]*?title="([^"]*)"[^>]*?href="([^"]*)"[^>]*?\/?>/gi,
    (_match, title: string, href: string) => `- [${title}](${href})`
  );

  // Convert <Aside type="..."> or <Aside> to blockquotes
  content = content.replace(/<Aside\s+type="(\w+)"[^>]*>/gi, (_match, type: string) => {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `> **${label}:**`;
  });
  content = content.replace(/<Aside[^>]*>/gi, '> **Note:**');
  content = content.replace(/<\/Aside>/gi, '');

  // Convert <TabItem label="..."> to ### headers
  content = content.replace(/<TabItem\s+label="([^"]+)"[^>]*>/gi, (_match, label: string) => {
    return `### ${label}`;
  });

  // Strip remaining component tags but keep their inner content
  const tagsToStrip = ['Steps', 'Card', 'CardGrid', 'Tabs', 'TabItem', 'Icon'];
  for (const tag of tagsToStrip) {
    content = content.replace(new RegExp(`<${tag}[^>]*/\\s*>`, 'gi'), '');
    content = content.replace(new RegExp(`<${tag}[^>]*>`, 'gi'), '');
    content = content.replace(new RegExp(`</${tag}>`, 'gi'), '');
  }

  return content;
}

/**
 * Clean up excessive blank lines left after stripping.
 */
function cleanBlankLines(content: string): string {
  return content.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug || 'index';
  const doc = docs.find((d) => d.slug === slug);

  if (!doc) {
    return new Response('Not found', { status: 404 });
  }

  let markdown = stripFrontmatter(doc.raw);
  markdown = stripImports(markdown);
  markdown = convertComponents(markdown);
  markdown = cleanBlankLines(markdown);

  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
