import { afterEach, describe, expect, it, vi } from "vitest";
import { collectGithub } from "../src/adapters/sources/github.js";
import { collectLastfm } from "../src/adapters/sources/lastfm.js";

function mockFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => ({
      ok: true,
      status: 200,
      json: async () => handler(String(input)),
      text: async () => "",
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectGithub", () => {
  it("arma chunks con perfil y repos, saltando forks y archivados", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/kev")) {
        return { name: "Kevin", bio: "dev", public_repos: 2, followers: 10 };
      }
      return [
        {
          name: "vaio",
          description: "agente",
          language: "TypeScript",
          stargazers_count: 5,
          topics: ["ai"],
          html_url: "https://github.com/kev/vaio",
          fork: false,
          archived: false,
        },
        {
          name: "un-fork",
          description: null,
          language: null,
          stargazers_count: 0,
          html_url: "https://github.com/kev/un-fork",
          fork: true,
          archived: false,
        },
      ];
    });

    const rows = await collectGithub({ user: "kev" });
    const text = rows.map((r) => r.chunk).join("\n");
    expect(rows[0]?.source).toBe("github");
    expect(text).toContain("Kevin");
    expect(text).toContain("vaio");
    expect(text).toContain("TypeScript");
    expect(text).not.toContain("un-fork");
  });
});

describe("collectLastfm", () => {
  it("arma un chunk con los artistas más escuchados", async () => {
    mockFetch(() => ({
      topartists: { artist: [{ name: "Radiohead" }, { name: "Tame Impala" }] },
    }));

    const rows = await collectLastfm({ apiKey: "k", user: "kev" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("lastfm");
    expect(rows[0]?.chunk).toContain("Radiohead");
    expect(rows[0]?.chunk).toContain("Tame Impala");
  });

  it("devuelve [] si no hay artistas", async () => {
    mockFetch(() => ({ topartists: { artist: [] } }));
    expect(await collectLastfm({ apiKey: "k", user: "kev" })).toEqual([]);
  });
});
