import * as Y from "yjs";

// Constants for Yjs shared type keys
export const PLAN_TEXT_KEY = "content";
export const PLAN_META_KEY = "meta";

export interface PlanMeta {
  title: string;
  status: string;
  updatedAt: number;
}

/** Create a new Yjs Plan document with predefined structure */
export function createPlanDoc(): Y.Doc {
  const doc = new Y.Doc();
  // Pre-initialize shared types so all clients agree on structure
  doc.getText(PLAN_TEXT_KEY);
  doc.getMap(PLAN_META_KEY);
  return doc;
}

/** Get the plan markdown content as string */
export function getPlanContent(doc: Y.Doc): string {
  return doc.getText(PLAN_TEXT_KEY).toString();
}

/** Replace plan content */
export function setPlanContent(doc: Y.Doc, content: string): void {
  const text = doc.getText(PLAN_TEXT_KEY);
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, content);
  });
}

/** Get plan metadata */
export function getPlanMeta(doc: Y.Doc): PlanMeta {
  const meta = doc.getMap(PLAN_META_KEY);
  return {
    title: (meta.get("title") as string) ?? "",
    status: (meta.get("status") as string) ?? "",
    updatedAt: (meta.get("updatedAt") as number) ?? 0,
  };
}

/** Update plan metadata (partial) */
export function setPlanMeta(doc: Y.Doc, updates: Partial<PlanMeta>): void {
  const meta = doc.getMap(PLAN_META_KEY);
  doc.transact(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) meta.set(key, value);
    }
  });
}

/** Encode Y.Doc to binary for DB storage */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Decode binary state into a new Y.Doc */
export function decodeDoc(update: Uint8Array): Y.Doc {
  const doc = createPlanDoc();
  Y.applyUpdate(doc, update);
  return doc;
}
