import type { PresenceEntry } from "@qwack/shared";
import { PresenceTracker } from "./presence-tracker";
import { MessageBuffer } from "./message-buffer";
import type { Message } from "./message-buffer";

const DEFAULT_LIMIT = 10;

interface Proposal {
  id: string;
  content: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  responderId?: string;
  responderName?: string;
  responseReason?: string;
  createdAt: number;
  resolvedAt?: number;
  acknowledged?: boolean;
}

export class CollaboratorState {
  private presence = new PresenceTracker();
  private messageBuffer = new MessageBuffer();
  private sessionTitle: string | null = null;
  private proposals = new Map<string, Proposal>();
  private transferContext: string | null = null;
  private eventHistory: string | null = null;

  addPresence(user: { id: string; name: string; role: string }): void {
    this.presence.add(user);
  }

  removePresence(userId: string): void {
    this.presence.remove(userId);
  }

  getPresenceList(): PresenceEntry[] {
    return this.presence.getAll();
  }

  getPresenceCount(): number {
    return this.presence.size;
  }

  addMessage(authorName: string, content: string): void {
    this.messageBuffer.add(authorName, content);
  }

  getRecentMessages(limit: number = DEFAULT_LIMIT): Message[] {
    return this.messageBuffer.getRecent(limit);
  }

  getUnprocessedMessages(): Message[] {
    return this.messageBuffer.getUnprocessed();
  }

  markMessagesProcessed(): void {
    this.messageBuffer.markProcessed();
  }

  setSessionTitle(title: string): void {
    this.sessionTitle = title;
  }

  getSessionTitle(): string | null {
    return this.sessionTitle;
  }

  setTransferContext(text: string): void {
    this.transferContext = text;
  }

  getTransferContext(): string | null {
    return this.transferContext;
  }

  setEventHistory(text: string): void {
    this.eventHistory = text;
  }

  getEventHistory(): string | null {
    return this.eventHistory;
  }

  formatEventHistoryForPrompt(events: Array<{ type: string; payload: Record<string, unknown> }>, charCap = 50_000): string {
    if (!events || events.length === 0) return "";
    const lines: string[] = ["## Previous Session History (for context continuity)"];
    let totalChars = lines[0].length;
    for (const evt of events) {
      let line = "";
      if (evt.type === "prompt:sent") {
        line = `[prompt] ${(evt.payload.authorName as string) ?? "user"}: ${evt.payload.content as string}`;
      } else if (evt.type === "agent:output") {
        const content = (evt.payload.content as string) ?? "";
        line = `[agent] ${content.slice(0, 500)}`;
      } else if (evt.type === "collab:message") {
        line = `[chat] ${evt.payload.authorName as string}: ${evt.payload.content as string}`;
      } else if (evt.type === "agent:complete") {
        line = "[agent response complete]";
      } else {
        continue;
      }
      if (totalChars + line.length + 1 > charCap) break;
      lines.push(line);
      totalChars += line.length + 1;
    }
    return lines.join("\n");
  }

  formatForSystemPrompt(): string {
    if (this.transferContext) {
      const ctx = this.transferContext;
      this.transferContext = null;
      const live = this.buildLiveContext();
      return live ? ctx + "\n\n" + live : ctx;
    }
    if (this.eventHistory) {
      const history = this.eventHistory;
      this.eventHistory = null;
      const live = this.buildLiveContext();
      return live ? history + "\n\n" + live : history;
    }
    return this.buildLiveContext();
  }

  private buildLiveContext(): string {
    if (this.presence.size === 0) return "";
    const collabs = this.presence.getAll().map((p) => `${p.name} (${p.role})`).join(", ");
    const lines: string[] = [];

    lines.push(`## Collaborative Session`);
    lines.push(`You are in a live Qwack collaboration session with: ${collabs}.`);
    lines.push(``);
    lines.push(`### Collaboration Rules`);
    lines.push(`- **Propose before executing.** Before making changes, briefly describe your plan and ask the team (especially the host) for confirmation. Example: "I'm planning to [action]. Sound good?"`);
    lines.push(`- **Acknowledge collaborator input.** When a teammate sends a message or prompt, reference their input in your response.`);
    lines.push(`- **Don't silently execute large changes.** Multi-file refactors, dependency additions, or architectural changes should always be proposed first.`);
    lines.push(`- **Small, obvious fixes are OK to just do.** Typo fixes, lint errors, and single-line changes don't need consensus.`);
    lines.push(`- **If teammates disagree, pause and ask.** Don't pick a side — present the tradeoffs and let the team decide.`);

    const recent = this.getRecentMessages();
    if (recent.length > 0) {
      lines.push(``);
      lines.push(`### Recent Team Discussion`);
      for (const m of recent) {
        lines.push(`- ${m.authorName}: "${m.content}"`);
      }
    }
    const pending = this.getPendingProposals();
    if (pending.length > 0) {
      lines.push(``);
      lines.push(`### Pending Proposals (awaiting team response)`);
      for (const p of pending) {
        lines.push(`- "${p.content}"`);
      }
    }
    return lines.join("\n");
  }

  formatForMessageInjection(): string {
    const unprocessed = this.getUnprocessedMessages();
    const resolutions = this.getUnacknowledgedResolutions();
    if (unprocessed.length === 0 && resolutions.length === 0) return "";
    const lines: string[] = [];
    if (unprocessed.length > 0) {
      lines.push("Your teammates just said some things:");
      for (const m of unprocessed) lines.push(`${m.authorName}: "${m.content}"`);
    }
    if (resolutions.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Team responses to your proposals:");
      for (const r of resolutions) {
        const verdict = r.status === "accepted" ? "✅ accepted" : "❌ rejected";
        const reason = r.responseReason ? ` — ${r.responderName}: ${r.responseReason}` : ` — ${r.responderName}`;
        lines.push(`${verdict} "${r.content}"${reason}`);
      }
    }
    this.acknowledgeResolutions();
    return lines.join("\n");
  }

  formatForCompaction(): string {
    const collabs = this.presence.getAll().map((p) => `${p.name} (${p.role})`).join(", ") || "none";
    const lines = [`You're in a Qwack session with ${collabs}.`];
    if (this.sessionTitle) lines.push(`Session: "${this.sessionTitle}".`);
    const recent = this.getRecentMessages();
    if (recent.length > 0) {
      const msgs = recent.map((m) => `${m.authorName}: "${m.content}"`).join("; ");
      lines.push(`Recent team discussion: ${msgs}.`);
    }
    return lines.join(" ");
  }

  addProposal(id: string, content: string, reason: string): void {
    this.proposals.set(id, { id, content, reason, status: "pending", createdAt: Date.now() });
  }

  resolveProposal(id: string, accepted: boolean, responderId: string, responderName: string, reason?: string): void {
    const proposal = this.proposals.get(id);
    if (!proposal) return;
    proposal.status = accepted ? "accepted" : "rejected";
    proposal.responderId = responderId;
    proposal.responderName = responderName;
    proposal.responseReason = reason;
    proposal.resolvedAt = Date.now();
  }

  getPendingProposals(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status === "pending");
  }

  getUnacknowledgedResolutions(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status !== "pending" && !p.acknowledged);
  }

  acknowledgeResolutions(): void {
    for (const p of this.proposals.values()) {
      if (p.status !== "pending") p.acknowledged = true;
    }
  }

  clear(): void {
    this.presence.clear();
    this.messageBuffer.clear();
    this.sessionTitle = null;
    this.proposals.clear();
    this.transferContext = null;
    this.eventHistory = null;
  }
}
