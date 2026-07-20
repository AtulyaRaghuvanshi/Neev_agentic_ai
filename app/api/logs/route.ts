import { errorResponse, getDb, json, requireAccount, safeJson } from "@/lib/server";

type LogRow = { id: string; name: string; detailsJson: string; createdAt: number };

export async function GET(request: Request) {
  try {
    const accountId = await requireAccount(request); const db = await getDb();
    const rows = await db.prepare('SELECT id, name, details_json AS "detailsJson", created_at AS "createdAt" FROM extraction_logs WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 5').bind(accountId).all<LogRow>();
    return json((rows.results || []).map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, details: safeJson(row.detailsJson, {}) })));
  } catch (error) { return errorResponse(error); }
}
