import { describe, it, expect } from "vitest";
import { parseRoute, viewPath, type ViewRequest } from "../../src/app/viewUrl";

/** Split a `viewPath` result back into (pathname, search) the way the router would. */
function parsePath(path: string) {
  const [pathname, search = ""] = path.split("?");
  return parseRoute(pathname!, search);
}

describe("viewUrl", () => {
  it("treats /, /configure, and unknown paths as the configure page", () => {
    expect(parseRoute("/", "")).toEqual({ page: "configure" });
    expect(parseRoute("/configure", "")).toEqual({ page: "configure" });
    expect(parseRoute("/anything-else", "?demo=x")).toEqual({ page: "configure" });
  });

  it("parses a demo request", () => {
    expect(parseRoute("/view", "?demo=refs")).toEqual({
      page: "view",
      request: { kind: "demo", demoId: "refs" },
    });
  });

  it("parses online document URLs, first = entry", () => {
    const route = parseRoute("/view", "?doc=https%3A%2F%2Fa%2Fx.yaml&doc=https%3A%2F%2Fa%2Fy.yaml");
    expect(route).toEqual({
      page: "view",
      request: {
        kind: "urls",
        docs: [
          { url: "https://a/x.yaml", isEntry: true },
          { url: "https://a/y.yaml", isEntry: false },
        ],
      },
    });
  });

  it("honors an explicit, in-range entry index and ignores a bad one", () => {
    const reqOf = (search: string) =>
      (parseRoute("/view", search) as { request: { kind: "urls"; docs: { isEntry: boolean }[] } })
        .request.docs.findIndex((d) => d.isEntry);
    expect(reqOf("?doc=a&doc=b&entry=1")).toBe(1);
    expect(reqOf("?doc=a&doc=b&entry=9")).toBe(0); // out of range -> first
    expect(reqOf("?doc=a&doc=b&entry=x")).toBe(0); // non-numeric -> first
  });

  it("drops empty doc params", () => {
    expect(parseRoute("/view", "?doc=&doc=a")).toEqual({
      page: "view",
      request: { kind: "urls", docs: [{ url: "a", isEntry: true }] },
    });
  });

  it("treats a bare /view as a session (upload) handoff", () => {
    expect(parseRoute("/view", "")).toEqual({ page: "view", request: { kind: "session" } });
    expect(parseRoute("/view/", "")).toEqual({ page: "view", request: { kind: "session" } });
  });

  it("round-trips each request kind through viewPath -> parseRoute", () => {
    const cases: ViewRequest[] = [
      { kind: "demo", demoId: "self" },
      { kind: "urls", docs: [{ url: "https://a/x.yaml", isEntry: true }, { url: "https://a/y.yaml", isEntry: false }] },
      { kind: "session" },
    ];
    for (const request of cases) {
      const route = parsePath(viewPath(request));
      expect(route).toEqual({ page: "view", request });
    }
  });

  it("viewPath puts the entry document first", () => {
    const path = viewPath({
      kind: "urls",
      docs: [
        { url: "https://a/extra.yaml", isEntry: false },
        { url: "https://a/main.yaml", isEntry: true },
      ],
    });
    const docs = (parsePath(path) as { request: { kind: "urls"; docs: { url: string; isEntry: boolean }[] } })
      .request.docs;
    expect(docs[0]).toEqual({ url: "https://a/main.yaml", isEntry: true });
  });
});
