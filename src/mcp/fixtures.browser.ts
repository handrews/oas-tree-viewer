// The browser fixture port: fetch the same-origin `/fixtures/…` files the app itself serves (see
// `fixtureUrl` in src/app/demos.ts). Node reads literally the same bytes at build time
// (fixtures.bundled.ts); this port fetches them at request time instead, because that is how the
// running app actually loads them — including under a sub-path deploy, which `fixtureUrl` already
// accounts for in the URL it hands this port.

import type { FixtureSource } from "./ports";

export const browserFixtures: FixtureSource = {
  async read(fixtureUrl: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(fixtureUrl, { signal });
    if (!res.ok) {
      throw new Error(
        `Could not fetch fixture "${fixtureUrl}": HTTP ${res.status} ${res.statusText}.`,
      );
    }
    return res.text();
  },
};
