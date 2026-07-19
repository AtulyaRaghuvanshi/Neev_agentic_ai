import { clearSessionCookie, constantTimeEqual, createSession, ensureSchema, errorResponse, getDb, hashPassword, json, randomToken, sha256 } from "@/lib/server";

type Context = { params: Promise<{ action: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { action } = await context.params; await ensureSchema();
    const db = await getDb();
    if (action === "logout") { const cookie = request.headers.get("cookie") || ""; const token = cookie.split(/;\s*/).find((part) => part.startsWith("neev_session="))?.split("=")[1]; if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run(); return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() }); }
    const body = await request.json() as { accountId?: string; password?: string }; const accountId = body.accountId?.trim().toLowerCase() || ""; const password = body.password || "";
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(accountId)) return Response.json({ error: "Account ID must be 3–40 letters, numbers, dots, dashes or underscores" }, { status: 400 });
    if (password.length < 8 || password.length > 128) return Response.json({ error: "Password must be 8–128 characters" }, { status: 400 });
    const existing = await db.prepare("SELECT id, password_hash AS passwordHash, salt FROM accounts WHERE id = ?").bind(accountId).first<{ id: string; passwordHash: string; salt: string }>();
    if (action === "register") { if (existing) return Response.json({ error: "That Account ID is already in use" }, { status: 409 }); const salt = randomToken(16); await db.prepare("INSERT INTO accounts (id, password_hash, salt, created_at) VALUES (?, ?, ?, ?)").bind(accountId, await hashPassword(password, salt), salt, Date.now()).run(); }
    else if (action === "login") { if (!existing || !constantTimeEqual(await hashPassword(password, existing.salt), existing.passwordHash)) return Response.json({ error: "Account ID or password is incorrect" }, { status: 401 }); }
    else return Response.json({ error: "Unknown authentication action" }, { status: 404 });
    const session = await createSession(accountId); const rows = await db.prepare("SELECT * FROM cases WHERE account_id = ? ORDER BY updated_at DESC").bind(accountId).all<Record<string, unknown>>();
    return json({ cases: (rows.results || []).map(mapCase) }, action === "register" ? 201 : 200, { "Set-Cookie": session.cookie });
  } catch (error) { return errorResponse(error); }
}

function mapCase(row: Record<string, unknown>) { return { id: row.id, service: row.service, state: row.state, district: row.district, language: row.language, status: row.status, step: row.step, profile: JSON.parse(String(row.profile_json || "{}")), plan: row.plan_json ? JSON.parse(String(row.plan_json)) : undefined, updatedAt: row.updated_at }; }
