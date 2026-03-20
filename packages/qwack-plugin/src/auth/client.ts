import type { QwackConfig } from "./store";

export interface QwackClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
  getWsUrl(sessionId: string): string;
}

export function createQwackClient(config: QwackConfig): QwackClient {
  const baseUrl = config.server.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}/api${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${config.token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "Unknown error");
      throw new Error(`Qwack API error ${response.status}: ${error}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
    getWsUrl: (sessionId: string) => {
      const wsBase = baseUrl.replace(/^http/, "ws");
      return `${wsBase}/ws?token=${encodeURIComponent(config.token)}&sessionId=${encodeURIComponent(sessionId)}`;
    },
  };
}
