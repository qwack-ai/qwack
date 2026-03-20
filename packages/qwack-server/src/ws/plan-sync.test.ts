import { describe, test, expect, beforeEach } from "bun:test";
import * as Y from "yjs";
import {
  getOrCreateDoc,
  getDocState,
  removeDoc,
  clearAllDocs,
} from "./plan-sync";

describe("Plan Sync — Doc Manager", () => {
  beforeEach(() => clearAllDocs());

  test("getOrCreateDoc creates a new doc", () => {
    const doc = getOrCreateDoc("session-1");
    expect(doc).toBeInstanceOf(Y.Doc);
  });

  test("getOrCreateDoc returns same doc for same session", () => {
    const doc1 = getOrCreateDoc("session-1");
    const doc2 = getOrCreateDoc("session-1");
    expect(doc1).toBe(doc2);
  });

  test("getOrCreateDoc creates distinct docs for different sessions", () => {
    const doc1 = getOrCreateDoc("session-1");
    const doc2 = getOrCreateDoc("session-2");
    expect(doc1).not.toBe(doc2);
  });

  test("getOrCreateDoc with initial state restores content", () => {
    const sourceDoc = new Y.Doc();
    sourceDoc.getText("content").insert(0, "Hello Plan");
    const state = Y.encodeStateAsUpdate(sourceDoc);
    sourceDoc.destroy();

    const doc = getOrCreateDoc("session-1", state);
    expect(doc.getText("content").toString()).toBe("Hello Plan");
  });

  test("getDocState returns encoded state", () => {
    const doc = getOrCreateDoc("session-1");
    doc.getText("content").insert(0, "Test content");

    const state = getDocState("session-1");
    expect(state).toBeInstanceOf(Uint8Array);

    // Verify by decoding into a new doc
    const restored = new Y.Doc();
    Y.applyUpdate(restored, state!);
    expect(restored.getText("content").toString()).toBe("Test content");
    restored.destroy();
  });

  test("getDocState returns null for unknown session", () => {
    expect(getDocState("nonexistent")).toBeNull();
  });

  test("removeDoc cleans up", () => {
    getOrCreateDoc("session-1");
    removeDoc("session-1");
    expect(getDocState("session-1")).toBeNull();
  });

  test("removeDoc is safe for nonexistent session", () => {
    expect(() => removeDoc("nonexistent")).not.toThrow();
  });

  test("clearAllDocs removes all sessions", () => {
    getOrCreateDoc("session-1");
    getOrCreateDoc("session-2");
    clearAllDocs();
    expect(getDocState("session-1")).toBeNull();
    expect(getDocState("session-2")).toBeNull();
  });

  test("Yjs updates merge correctly across docs", () => {
    const doc = getOrCreateDoc("session-1");
    doc.getText("content").insert(0, "Hello");

    // Simulate a second client's update
    const clientDoc = new Y.Doc();
    const serverState = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(clientDoc, serverState);
    clientDoc.getText("content").insert(5, " World");
    const clientUpdate = Y.encodeStateAsUpdate(clientDoc);

    // Apply client update to server doc
    Y.applyUpdate(doc, clientUpdate);
    expect(doc.getText("content").toString()).toBe("Hello World");
    clientDoc.destroy();
  });
});
