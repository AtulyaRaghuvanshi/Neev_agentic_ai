export type IdentityField = { value: string; confidence: number; source: string };
export type EvidenceDocument = { id: string; fields?: Record<string, string>; confidence?: number };

export function normaliseIdentity(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function similarity(left: string, right: string) {
  const a = normaliseIdentity(left); const b = normaliseIdentity(right);
  if (!a || !b) return 0; if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j]; previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)); diagonal = old;
    }
  }
  return Math.max(0, 1 - previous[b.length] / Math.max(a.length, b.length));
}

export function resolveEvidence(documents: EvidenceDocument[]) {
  const grouped = new Map<string, IdentityField[]>();
  for (const document of documents) for (const [key, value] of Object.entries(document.fields || {})) {
    const rows = grouped.get(key) || []; rows.push({ value, confidence: document.confidence || 0, source: document.id }); grouped.set(key, rows);
  }
  return Object.fromEntries([...grouped].map(([key, rows]) => {
    const scored = rows.map((candidate) => ({ ...candidate, confidence: candidate.confidence * (rows.reduce((sum, other) => sum + similarity(candidate.value, other.value), 0) / rows.length) })).sort((a, b) => b.confidence - a.confidence);
    return [key, { selected: scored[0], candidates: scored, conflict: scored.some((row) => similarity(row.value, scored[0].value) < 0.78) }];
  }));
}

export function unlockNext<T extends { state: "ready" | "locked" | "complete" }>(steps: T[], completedIndex: number) {
  return steps.map((step, index) => index === completedIndex ? { ...step, state: "complete" as const } : index === completedIndex + 1 ? { ...step, state: "ready" as const } : step);
}

export function parseTodoLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim())
    .map((line) => line.replace(/^```\w*|```$/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^\s*\[[ xX]?\]\s*/, "").replace(/^TODO\s*:?\s*/i, "").trim())
    .filter((line) => line.length > 2 && !/^(?:todo|checklist|steps?)\s*:$/i.test(line))
    .slice(0, 6);
}
