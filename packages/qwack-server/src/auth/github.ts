export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

const GITHUB_HEADERS = {
  "User-Agent": "qwack",
  Accept: "application/vnd.github+json",
} as const;

export async function getGithubUser(
  accessToken: string,
): Promise<GithubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<GithubUser>;
}

export async function getGithubPrimaryEmail(
  accessToken: string,
): Promise<string> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }
  const emails = (await response.json()) as GithubEmail[];
  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) {
    throw new Error("No verified primary email found on GitHub account");
  }
  return primary.email;
}
