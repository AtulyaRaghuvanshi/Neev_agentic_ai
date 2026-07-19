import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("sessions_expiry_idx").on(table.expiresAt)]);

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  state: text("state").notNull().default(""),
  district: text("district").notNull().default(""),
  language: text("language").notNull().default("en"),
  status: text("status").notNull(),
  step: integer("step").notNull().default(0),
  profileJson: text("profile_json").notNull().default("{}"),
  planJson: text("plan_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("cases_account_idx").on(table.accountId, table.updatedAt)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull().default(0),
  extractedJson: text("extracted_json").notNull().default("{}"),
  issue: text("issue"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("documents_case_idx").on(table.caseId, table.createdAt)]);

export const extractionLogs = sqliteTable("extraction_logs", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("extraction_logs_account_idx").on(table.accountId, table.createdAt)]);
