type D1Result<T = Record<string, unknown>> = { results?: T[]; success?: boolean };
type D1Statement = { bind: (...values: unknown[]) => D1Statement; first: <T = Record<string, unknown>>() => Promise<T | null>; run: () => Promise<unknown>; all: <T = Record<string, unknown>>() => Promise<D1Result<T>> };
type D1 = { prepare: (sql: string) => D1Statement; batch: (statements: D1Statement[]) => Promise<unknown> };
type Bucket = { put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown>; get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> };
type RuntimeEnv = { GEMINI_API_KEYS?: string; GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GROQ_API_KEYS?: string; GROQ_API_KEY?: string; GROQ_MODEL?: string };

async function getRuntime(): Promise<RuntimeEnv> { return process.env as unknown as RuntimeEnv; }
const SESSION_COOKIE = "neev_session";
const DAY = 86_400_000;

let databasePromise: Promise<D1> | null = null;
function postgresPlaceholders(query: string) { let index = 0; return query.replace(/\?/g, () => `$${++index}`); }
async function createNetlifyDatabase(): Promise<D1> {
  const { getDatabase } = await import("@netlify/database");
  const connectionString = process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;
  const connection = getDatabase(connectionString ? { connectionString } : undefined);
  const prepare = (sql: string): D1Statement => {
    let values: unknown[] = [];
    const execute = async () => {
      const result = await connection.pool.query(postgresPlaceholders(sql), values);
      return result.rows as Record<string, unknown>[];
    };
    const statement: D1Statement = {
      bind: (...nextValues: unknown[]) => { values = nextValues; return statement; },
      first: async <T = Record<string, unknown>>() => (await execute())[0] as T | undefined || null,
      run: async () => { await execute(); return { success: true }; },
      all: async <T = Record<string, unknown>>() => ({ results: await execute() as T[], success: true }),
    };
    return statement;
  };
  return {
    prepare,
    batch: async (statements) => { for (const statement of statements) await statement.run(); return { success: true }; },
  };
}

export async function getDb() { databasePromise ||= createNetlifyDatabase(); return databasePromise; }

let bucketPromise: Promise<Bucket> | null = null;
async function createNetlifyBucket(): Promise<Bucket> {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("neev-identity-documents");
  return {
    put: async (key, value, options) => {
      const input = options as { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | undefined;
      return store.set(key, value, {
        metadata: { ...(input?.customMetadata || {}), contentType: input?.httpMetadata?.contentType || "application/octet-stream" },
        onlyIfNew: true,
      });
    },
    get: async (key) => {
      const value = await store.get(key, { type: "arrayBuffer" }).catch(() => null);
      return value ? { arrayBuffer: async () => value } : null;
    },
  };
}

export async function getBucket() { bucketPromise ||= createNetlifyBucket(); return bucketPromise; }

export async function ensureSchema() {
  const db = await getDb();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at BIGINT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at BIGINT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, service TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', status TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, profile_json TEXT NOT NULL DEFAULT '{}', plan_json TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, type TEXT NOT NULL, file_name TEXT NOT NULL, object_key TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL, confidence INTEGER NOT NULL DEFAULT 0, extracted_json TEXT NOT NULL DEFAULT '{}', issue TEXT, created_at BIGINT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE)"),
    db.prepare("CREATE TABLE IF NOT EXISTS extraction_logs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, case_id TEXT NOT NULL, name TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS cases_account_idx ON cases(account_id, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS documents_case_idx ON documents(case_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS extraction_logs_account_idx ON extraction_logs(account_id, created_at)"),
  ]);
}

function bytesToHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex: string) { return new Uint8Array(hex.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) || []); }
export function randomToken(bytes = 32) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return bytesToHex(value); }
export async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
export async function hashPassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 120_000, hash: "SHA-256" }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
export function constantTimeEqual(a: string, b: string) { if (a.length !== b.length) return false; let value = 0; for (let i = 0; i < a.length; i++) value |= a.charCodeAt(i) ^ b.charCodeAt(i); return value === 0; }

export async function createSession(accountId: string) {
  const token = randomToken(); const tokenHash = await sha256(token); const expiresAt = Date.now() + 30 * DAY;
  await (await getDb()).prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, accountId, expiresAt).run();
  return { token, cookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` };
}
export async function sessionAccount(request: Request) {
  await ensureSchema(); const cookie = request.headers.get("cookie") || ""; const token = cookie.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.split("=")[1]; if (!token) return null;
  const row = await (await getDb()).prepare("SELECT account_id AS accountId FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(await sha256(token), Date.now()).first<{ accountId: string }>(); return row?.accountId || null;
}
export async function requireAccount(request: Request) { const accountId = await sessionAccount(request); if (!accountId) throw new Response(JSON.stringify({ error: "Please sign in to continue" }), { status: 401, headers: { "Content-Type": "application/json" } }); return accountId; }
export function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

export function json(data: unknown, status = 200, headers?: HeadersInit) { return Response.json({ data }, { status, headers }); }
export function errorResponse(error: unknown) { if (error instanceof Response) return error; const message = error instanceof Error ? error.message : "Unexpected error"; return Response.json({ error: message }, { status: 500 }); }
export function safeJson<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }

function splitKeys(...values: (string | undefined)[]) { return values.flatMap((value) => (value || "").split(",")).map((key) => key.trim()).filter(Boolean); }
function stripJson(text: string) { return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); }
function toBase64(buffer: ArrayBuffer) { const bytes = new Uint8Array(buffer); let binary = ""; for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000)); return btoa(binary); }

async function geminiResponse(key: string, model: string, prompt: string, image?: ArrayBuffer, mimeType?: string, jsonMode = false) {
  const parts: Record<string, unknown>[] = [{ text: prompt }]; if (image) parts.push({ inline_data: { mime_type: mimeType || "image/jpeg", data: toBase64(image) } });
  const generationConfig: Record<string, unknown> = { temperature: 0.1 }; if (jsonMode) generationConfig.responseMimeType = "application/json";
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }) });
}

async function groqResponse(key: string, model: string, prompt: string, image?: ArrayBuffer, mimeType?: string, jsonMode = false) {
  const isImage = Boolean(image && (mimeType || "").startsWith("image/"));
  const content: unknown = isImage ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${toBase64(image!)}` } }] : prompt;
  const isQwen36 = model === "qwen/qwen3.6-27b";
  const instruction = jsonMode ? "Return one valid JSON object and no markdown." : "Follow the requested output format exactly. Be concise.";
  const messages = isQwen36 ? [{ role: "user", content: `${instruction}\n\n${typeof content === "string" ? content : prompt}` }] : [{ role: "system", content: instruction }, { role: "user", content }];
  const body: Record<string, unknown> = { model, messages, temperature: isQwen36 ? 0.7 : 0.1 };
  if (isQwen36) { body.reasoning_effort = "none"; body.reasoning_format = "hidden"; }
  if (jsonMode) body.response_format = { type: "json_object" };
  return fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export type AITrace = { selected?: { provider: "gemini" | "groq" | "local"; model: string }; attempts: { provider: "gemini" | "groq"; model: string; status?: number; error?: string }[] };

export async function runAI<T>({ prompt, image, mimeType, fallback, trace }: { prompt: string; image?: ArrayBuffer; mimeType?: string; fallback?: T; trace?: AITrace }): Promise<T> {
  const runtime = await getRuntime();
  const errors: string[] = [];
  const geminiKeys = splitKeys(runtime.GEMINI_API_KEYS, runtime.GEMINI_API_KEY);
  const geminiModels = [...new Set(splitKeys(runtime.GEMINI_MODEL, "gemini-3.5-flash"))];
  for (const model of geminiModels) for (const key of geminiKeys) try {
    let response = await geminiResponse(key, model, prompt, image, mimeType, true);
    if (response.status === 400) response = await geminiResponse(key, model, prompt, image, mimeType, false);
    if (!response.ok) { errors.push(`Gemini ${model}: HTTP ${response.status}`); trace?.attempts.push({ provider: "gemini", model, status: response.status }); continue; }
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }; const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || ""; const result = JSON.parse(stripJson(text)) as T; if (trace) trace.selected = { provider: "gemini", model }; return result;
  } catch (error) { const message = error instanceof Error ? error.message : "invalid response"; errors.push(`Gemini ${model}: ${message}`); trace?.attempts.push({ provider: "gemini", model, error: message }); }

  const groqKeys = splitKeys(runtime.GROQ_API_KEYS, runtime.GROQ_API_KEY);
  const groqModels = [...new Set(splitKeys(runtime.GROQ_MODEL, "qwen/qwen3.6-27b"))];
  for (const model of groqModels) for (const key of groqKeys) try {
    let response = await groqResponse(key, model, prompt, image, mimeType, true);
    if (response.status === 400) response = await groqResponse(key, model, prompt, image, mimeType, false);
    if (!response.ok) { errors.push(`Groq ${model}: HTTP ${response.status}`); trace?.attempts.push({ provider: "groq", model, status: response.status }); continue; }
    const body = await response.json() as { choices?: { message?: { content?: string } }[] }; const result = JSON.parse(stripJson(body.choices?.[0]?.message?.content || "{}")) as T; if (trace) trace.selected = { provider: "groq", model }; return result;
  } catch (error) { const message = error instanceof Error ? error.message : "invalid response"; errors.push(`Groq ${model}: ${message}`); trace?.attempts.push({ provider: "groq", model, error: message }); }
  if (fallback !== undefined) { if (trace) trace.selected = { provider: "local", model: "tesseract.js + rule parser" }; return fallback; }
  if (!geminiKeys.length && !groqKeys.length) throw new Error("No AI key reached the server. Add a local .env key and restart Vite, or configure Worker secrets for the deployed app.");
  throw new Error(`All configured AI providers failed. ${[...new Set(errors)].join("; ")}`);
}

export async function runTextAI({ prompt }: { prompt: string }): Promise<string> {
  const runtime = await getRuntime(); const errors: string[] = [];
  const geminiKeys = splitKeys(runtime.GEMINI_API_KEYS, runtime.GEMINI_API_KEY);
  for (const model of [...new Set(splitKeys(runtime.GEMINI_MODEL, "gemini-3.5-flash"))]) for (const key of geminiKeys) try {
    const response = await geminiResponse(key, model, prompt);
    if (!response.ok) { errors.push(`Gemini ${model}: HTTP ${response.status}`); continue; }
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim(); if (text) return text;
    errors.push(`Gemini ${model}: empty response`);
  } catch (error) { errors.push(`Gemini ${model}: ${error instanceof Error ? error.message : "invalid response"}`); }

  const groqKeys = splitKeys(runtime.GROQ_API_KEYS, runtime.GROQ_API_KEY);
  for (const model of [...new Set(splitKeys(runtime.GROQ_MODEL, "qwen/qwen3.6-27b"))]) for (const key of groqKeys) try {
    const response = await groqResponse(key, model, prompt);
    if (!response.ok) { errors.push(`Groq ${model}: HTTP ${response.status}`); continue; }
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim(); if (text) return text;
    errors.push(`Groq ${model}: empty response`);
  } catch (error) { errors.push(`Groq ${model}: ${error instanceof Error ? error.message : "invalid response"}`); }

  if (!geminiKeys.length && !groqKeys.length) throw new Error("No AI key reached the server. Add a local .env key and restart Vite, or configure Worker secrets for the deployed app.");
  throw new Error(`All configured AI providers failed. ${[...new Set(errors)].join("; ")}`);
}
