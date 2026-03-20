import type { PresenceEntry } from "@qwack/shared";

export class PresenceTracker {
  private presence = new Map<string, PresenceEntry>();

  add(user: { id: string; name: string; role: string }): void {
    this.presence.set(user.id, { id: user.id, name: user.name, role: user.role });
  }

  remove(userId: string): void {
    this.presence.delete(userId);
  }

  get(userId: string): PresenceEntry | undefined {
    return this.presence.get(userId);
  }

  getAll(): PresenceEntry[] {
    return [...this.presence.values()];
  }

  updateRole(userId: string, role: string): void {
    const entry = this.presence.get(userId);
    if (entry) {
      entry.role = role;
    }
  }

  clear(): void {
    this.presence.clear();
  }

  get size(): number {
    return this.presence.size;
  }
}
