import { MAX_COLLAB_MESSAGES } from "@qwack/shared";

interface Message {
  authorName: string;
  content: string;
  timestamp: number;
}

export { type Message };

export class MessageBuffer {
  static readonly MAX_MESSAGES = MAX_COLLAB_MESSAGES;

  private messages: Message[] = [];
  private processedIndex = 0;

  add(authorName: string, content: string): void {
    this.messages.push({ authorName, content, timestamp: Date.now() });
    if (this.messages.length > MessageBuffer.MAX_MESSAGES) {
      this.messages.shift();
      this.processedIndex = Math.max(0, this.processedIndex - 1);
    }
  }

  getRecent(limit: number = 10): Message[] {
    return this.messages.slice(-limit);
  }

  getUnprocessed(): Message[] {
    return this.messages.slice(this.processedIndex);
  }

  markProcessed(): void {
    this.processedIndex = this.messages.length;
  }

  clear(): void {
    this.messages = [];
    this.processedIndex = 0;
  }
}
