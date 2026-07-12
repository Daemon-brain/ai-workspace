/**
 * DATABASE SCHEMA — all tables prefixed `aiw_` so the module can share a
 * database with any host application without collisions.
 *
 * userId is a plain text column filled from the `x-workspace-user` header —
 * the HOST app owns authentication; this module just scopes data by the id it
 * is handed (defaults to "local" for standalone use).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const providers = pgTable("aiw_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().default("local"),
  catalogId: text("catalog_id").notNull(),
  name: text("name").notNull(),
  adapter: text("adapter").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc"), // null for keyless/local providers
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100), // lower = tried first
  timeoutMs: integer("timeout_ms").notNull().default(120_000),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const models = pgTable(
  "aiw_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    label: text("label"),
    enabled: boolean("enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aiw_models_provider_idx").on(t.providerId)],
);

export const conversations = pgTable(
  "aiw_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().default("local"),
    title: text("title").notNull().default("New chat"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aiw_conversations_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "aiw_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    reasoning: text("reasoning"), // collapsible thinking, when the model streams it
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aiw_messages_conv_idx").on(t.conversationId)],
);

export const settings = pgTable(
  "aiw_settings",
  {
    userId: text("user_id").notNull().default("local"),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const usageLog = pgTable(
  "aiw_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    userId: text("user_id").notNull().default("local"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome").notNull(), // ok | error | aborted
    errorClass: text("error_class"),
  },
  (t) => [index("aiw_usage_ts_idx").on(t.ts)],
);
