import {
  sqliteTable,
  text,
  integer,
  blob,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  githubId: text("github_id").unique(),
  passwordHash: text("password_hash"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", { enum: ["active", "inactive"] })
    .notNull()
    .default("active"),
  creatorId: text("creator_id").references(() => users.id),
  agentAutonomy: text("agent_autonomy").notNull().default("hybrid"),
  permissionModel: text("permission_model")
    .notNull()
    .default("host_decides"),
  disagreementThreshold: text("disagreement_threshold")
    .notNull()
    .default("configurable"),
  planYjsState: blob("plan_yjs_state", { mode: "buffer" }),
  shortCode: text("short_code").unique(),
  contextSnapshot: text("context_snapshot"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sessionParticipants = sqliteTable(
  "session_participants",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("collaborator"),
    isConnected: integer("is_connected", { mode: "boolean" }).default(false),
    joinedAt: integer("joined_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("session_user_unique").on(table.sessionId, table.userId),
  ],
);

export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    type: text("type").notNull(),
    actorType: text("actor_type", {
      enum: ["user", "agent", "system"],
    }).notNull(),
    actorId: text("actor_id"),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("session_events_session_idx").on(table.sessionId),
    index("session_events_timestamp_idx").on(table.timestamp),
  ],
);

