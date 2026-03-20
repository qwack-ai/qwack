import { describe, test, expect, mock, afterEach } from "bun:test";
import { getGithubUser, getGithubPrimaryEmail } from "./github";

const originalFetch = globalThis.fetch;

function mockFetch(fn: () => Promise<Response>) {
  const mocked = mock(fn);
  globalThis.fetch = mocked as unknown as typeof fetch;
  return mocked;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getGithubUser", () => {
  test("parses response correctly", async () => {
    const mockUser = {
      id: 123,
      login: "qwackdev",
      name: "Qwack Dev",
      avatar_url: "https://avatars.githubusercontent.com/u/123",
    };

    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200 })),
    );

    const user = await getGithubUser("test-token");
    expect(user).toEqual(mockUser);
  });

  test("sends correct headers", async () => {
    const mocked = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );

    await getGithubUser("my-token");

    const call = mocked.mock.calls[0];
    const [url, opts] = call as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-token",
    );
    expect((opts.headers as Record<string, string>)["User-Agent"]).toBe(
      "qwack",
    );
  });

  test("throws on non-OK response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response("", { status: 401, statusText: "Unauthorized" }),
      ),
    );

    expect(getGithubUser("bad-token")).rejects.toThrow(
      "GitHub API error: 401 Unauthorized",
    );
  });
});

describe("getGithubPrimaryEmail", () => {
  test("finds primary verified email", async () => {
    const emails = [
      { email: "other@example.com", primary: false, verified: true },
      { email: "primary@example.com", primary: true, verified: true },
      { email: "unverified@example.com", primary: true, verified: false },
    ];

    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify(emails), { status: 200 })),
    );

    const email = await getGithubPrimaryEmail("test-token");
    expect(email).toBe("primary@example.com");
  });

  test("throws when no verified primary email", async () => {
    const emails = [
      { email: "unverified@example.com", primary: true, verified: false },
      { email: "nonprimary@example.com", primary: false, verified: true },
    ];

    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify(emails), { status: 200 })),
    );

    expect(getGithubPrimaryEmail("test-token")).rejects.toThrow(
      "No verified primary email found on GitHub account",
    );
  });

  test("throws on non-OK response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response("", { status: 403, statusText: "Forbidden" }),
      ),
    );

    expect(getGithubPrimaryEmail("bad-token")).rejects.toThrow(
      "GitHub API error: 403 Forbidden",
    );
  });
});
