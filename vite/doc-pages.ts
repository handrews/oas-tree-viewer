// Renders the CHANGELOG (and any future doc pages) into standalone, themed HTML that ships
// with the app and has its own URL (/changelog.html). In dev the pages are served by
// middleware; in the production build they are emitted into the output directory, so they
// vendor into the deployed site alongside index.html.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";
import type { Plugin } from "vite";

interface DocPage {
  /** URL slug and output filename stem: "readme" -> /readme.html. */
  slug: string;
  /** Page <title> and header label. */
  title: string;
  /** Markdown source, relative to the project root. */
  source: string;
}

const PAGES: DocPage[] = [
  // The README is intentionally not rendered here — the header's GitHub link covers it, so we
  // sidestep whether it reads as developer vs. end-user docs. Add end-user pages here later.
  { slug: "changelog", title: "Changelog", source: "CHANGELOG.md" },
];

const REPO = "https://github.com/handrews/oas-tree-viewer";
const SITE_TITLE = "OpenAPI Description Structure Viewer";
const THEME_KEY = "oas-tree-viewer:theme";

/** Resolve a path against the project root (cwd is the package root when Vite runs). */
function fromRoot(rel: string): string {
  return resolve(process.cwd(), rel);
}

/** docs.css with its `@import "./theme.css"` inlined, so a page needs no external CSS. */
function inlineStyles(): string {
  const theme = readFileSync(fromRoot("src/theme.css"), "utf8");
  const docs = readFileSync(fromRoot("src/docs.css"), "utf8");
  return docs.replace(/@import[^;]*theme\.css[^;]*;\s*/g, `${theme}\n`);
}

/** Render a markdown source to the body HTML, pointing repo-relative links at GitHub. */
function renderBody(source: string): string {
  const md = readFileSync(fromRoot(source), "utf8");
  const html = marked.parse(md, { gfm: true, async: false });
  return (
    html
      // Links like `public/fixtures` or `test` are repo-relative; rewrite them so they work
      // off GitHub. Absolute URLs, in-page anchors, and mailto links are left untouched.
      .replace(/href="(?!https?:\/\/|#|mailto:|\/)([^"]+)"/g, `href="${REPO}/blob/main/$1"`)
      // Code blocks scroll horizontally (overflow-x), so they must be keyboard-focusable to
      // satisfy WCAG (axe scrollable-region-focusable).
      .replace(/<pre>/g, '<pre tabindex="0">')
  );
}

/** The full standalone HTML document for a doc page. */
function renderPage(page: DocPage): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${page.title} — ${SITE_TITLE}</title>
    <style>${inlineStyles()}</style>
    <script>
      // Apply the stored (else OS-preferred) theme before paint so the page matches the
      // app and there is no flash of the wrong palette.
      (function () {
        try {
          var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
              ? "light"
              : "dark";
          }
          document.documentElement.setAttribute("data-theme", t);
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <header class="doc-header">
      <a class="doc-home" href="./">&larr; ${SITE_TITLE}</a>
      <button id="doc-theme" class="doc-theme" type="button" aria-label="Switch theme">&#9790;</button>
    </header>
    <main class="doc">
${renderBody(page.source)}
    </main>
    <script>
      // Theme toggle mirroring the app: flip data-theme and remember the choice.
      (function () {
        var KEY = ${JSON.stringify(THEME_KEY)};
        var btn = document.getElementById("doc-theme");
        function sync() {
          var dark = document.documentElement.getAttribute("data-theme") !== "light";
          btn.textContent = dark ? "\\u263E" : "\\u2600";
          btn.setAttribute("aria-label", "Switch to " + (dark ? "light" : "dark") + " theme");
        }
        sync();
        btn.addEventListener("click", function () {
          var next =
            document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
          document.documentElement.setAttribute("data-theme", next);
          try {
            localStorage.setItem(KEY, next);
          } catch (e) {}
          sync();
        });
      })();
    </script>
  </body>
</html>
`;
}

/** Match a doc-page request path (`/changelog` or `/changelog.html`) to its slug. */
const PAGE_PATH = new RegExp(`^/(${PAGES.map((p) => p.slug).join("|")})(?:\\.html)?$`);
function slugForPath(pathname: string): string | null {
  const m = PAGE_PATH.exec(pathname);
  return m ? m[1] : null;
}

export function docPages(): Plugin {
  return {
    name: "oas-doc-pages",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        const slug = slugForPath(pathname);
        const page = slug ? PAGES.find((p) => p.slug === slug) : undefined;
        if (!page) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderPage(page));
      });
    },
    generateBundle() {
      for (const page of PAGES) {
        this.emitFile({ type: "asset", fileName: `${page.slug}.html`, source: renderPage(page) });
      }
    },
  };
}
