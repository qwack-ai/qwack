import { describe, test, expect } from "bun:test";
import * as Y from "yjs";
import {
  createPlanDoc,
  getPlanContent,
  setPlanContent,
  getPlanMeta,
  setPlanMeta,
  encodeDoc,
  decodeDoc,
  PLAN_TEXT_KEY,
  PLAN_META_KEY,
} from "./plan-doc";

describe("Plan CRDT", () => {
  test("createPlanDoc creates a doc with getText and getMap accessible", () => {
    const doc = createPlanDoc();
    expect(doc).toBeDefined();
    expect(doc.getText(PLAN_TEXT_KEY)).toBeDefined();
    expect(doc.getMap(PLAN_META_KEY)).toBeDefined();
  });

  test("set and get content", () => {
    const doc = createPlanDoc();
    const content = "# Plan\n1. Step one\n2. Step two";
    setPlanContent(doc, content);
    expect(getPlanContent(doc)).toBe(content);
  });

  test("get and set metadata", () => {
    const doc = createPlanDoc();
    const now = Date.now();
    setPlanMeta(doc, {
      title: "Auth Refactor",
      status: "in_progress",
      updatedAt: now,
    });

    const meta = getPlanMeta(doc);
    expect(meta.title).toBe("Auth Refactor");
    expect(meta.status).toBe("in_progress");
    expect(meta.updatedAt).toBe(now);
  });

  test("partial metadata update preserves other fields", () => {
    const doc = createPlanDoc();
    const now = Date.now();

    // Set all fields
    setPlanMeta(doc, {
      title: "Original Title",
      status: "pending",
      updatedAt: now,
    });

    // Update only title
    setPlanMeta(doc, { title: "Updated Title" });

    const meta = getPlanMeta(doc);
    expect(meta.title).toBe("Updated Title");
    expect(meta.status).toBe("pending");
    expect(meta.updatedAt).toBe(now);
  });

  test("encode and decode roundtrip preserves content and metadata", () => {
    const doc1 = createPlanDoc();
    const content = "# Refactor\n1. Extract JWT logic";
    const now = Date.now();

    setPlanContent(doc1, content);
    setPlanMeta(doc1, {
      title: "JWT Refactor",
      status: "active",
      updatedAt: now,
    });

    // Encode to binary
    const encoded = encodeDoc(doc1);
    expect(encoded).toBeInstanceOf(Uint8Array);

    // Decode into new doc
    const doc2 = decodeDoc(encoded);

    // Verify content and metadata preserved
    expect(getPlanContent(doc2)).toBe(content);
    const meta = getPlanMeta(doc2);
    expect(meta.title).toBe("JWT Refactor");
    expect(meta.status).toBe("active");
    expect(meta.updatedAt).toBe(now);
  });

  test("two-doc merge converges via Y.applyUpdate", () => {
    const doc1 = createPlanDoc();
    const doc2 = createPlanDoc();

    // Set content on doc1
    setPlanContent(doc1, "# Plan A");

    // Get update from doc1 and apply to doc2
    const update1 = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update1);

    // doc2 should now have doc1's content
    expect(getPlanContent(doc2)).toBe("# Plan A");

    // Set metadata on doc2
    setPlanMeta(doc2, { title: "Plan B" });

    // Get update from doc2 and apply to doc1
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, update2);

    // Both should have converged metadata
    const meta1 = getPlanMeta(doc1);
    const meta2 = getPlanMeta(doc2);
    expect(meta1.title).toBe(meta2.title);
    expect(meta1.title).toBe("Plan B");
  });

  test("empty doc returns default values", () => {
    const doc = createPlanDoc();

    expect(getPlanContent(doc)).toBe("");

    const meta = getPlanMeta(doc);
    expect(meta.title).toBe("");
    expect(meta.status).toBe("");
    expect(meta.updatedAt).toBe(0);
  });
});
