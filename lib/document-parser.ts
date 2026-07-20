export type LocalExtraction = {
  fields: Record<string, string>;
  signature: { present: boolean; confidence: number };
  stamp: { present: boolean; confidence: number };
  confidence: number;
  conflicts: string[];
  notes: string[];
  text: string;
};

function clean(value: string) {
  return value.replace(/[ \t]+/g, " ").replace(/^[:\-–—\s]+|[|\s]+$/g, "").trim();
}

function labelled(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:\\-]?\\s*([^\\n|]{2,100})`, "im"));
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function firstMatch(text: string, expressions: RegExp[]) {
  for (const expression of expressions) {
    const match = text.match(expression);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

const identityKeys = new Set(["name", "date_of_birth", "address", "guardian_name", "document_number", "issuing_authority"]);
function personName(value: string) {
  if (value.length < 3 || value.length > 100 || /[\d/\\|]/.test(value)) return "";
  if (/\b(?:name|father|mother|guardian|date|birth|dob|pan|income\s+tax)\b/i.test(value)) return "";
  const letters = value.match(/\p{L}/gu)?.length || 0;
  return letters >= 3 && letters / value.length >= 0.55 ? value : "";
}
function dateOfBirth(value: string) {
  const numeric = value.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
  if (numeric) {
    const day = Number(numeric[1]); const month = Number(numeric[2]); const year = Number(numeric[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= new Date().getFullYear()) return numeric[0];
  }
  const words = value.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i);
  return words ? words[0] : "";
}
function documentNumber(value: string, declaredType: string) {
  const compact = value.toUpperCase().replace(/\s+/g, ""); const type = declaredType.toLowerCase();
  if (type.includes("pan")) return /^[A-Z]{5}\d{4}[A-Z]$/.test(compact) ? compact : "";
  if (type.includes("aadhaar")) return /^\d{12}$/.test(compact) ? compact.replace(/(\d{4})(?=\d)/g, "$1 ") : "";
  if (type.includes("voter")) return /^[A-Z]{3}\d{7}$/.test(compact) ? compact : "";
  return /^[\p{L}\d][\p{L}\d/._\-]{2,39}$/u.test(compact) ? compact : "";
}

/** Reject OCR label fragments and impossible identity values before review. */
export function sanitizeExtractedFields(input: unknown, declaredType: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const fields: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (!identityKeys.has(key) || typeof rawValue !== "string") continue;
    const value = clean(rawValue).slice(0, 500); let accepted = "";
    if (key === "name" || key === "guardian_name") accepted = personName(value);
    else if (key === "date_of_birth") accepted = dateOfBirth(value);
    else if (key === "document_number") accepted = documentNumber(value, declaredType);
    else if (key === "address") accepted = value.length >= 8 && !/\b(?:address|name|dob)\b/i.test(value) ? value : "";
    else if (key === "issuing_authority") accepted = value.length >= 3 && !/[|]/.test(value) ? value : "";
    if (accepted) fields[key] = accepted;
  }
  return fields;
}

export function mergeExtractedFields(primary: unknown, local: unknown, declaredType: string) {
  // Vision extraction is primary; local OCR only fills a missing, independently valid field.
  return { ...sanitizeExtractedFields(local, declaredType), ...sanitizeExtractedFields(primary, declaredType) };
}

function fieldsFromText(text: string, declaredType: string) {
  const fields: Record<string, string> = {};
  const name = labelled(text, ["name(?: of (?:student|candidate|holder))?", "student(?:'s)? name", "नाम"]);
  const dob = labelled(text, ["date of birth", "d\\.?o\\.?b\\.?", "birth date", "जन्म(?: तिथि| दिनांक)?"])
    || firstMatch(text, [/\b(?:DOB|D\.O\.B\.?)[^\d]{0,8}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/i]);
  const guardian = labelled(text, ["(?:father|mother|guardian)(?:'s)? name", "पिता(?: का नाम)?", "माता(?: का नाम)?", "अभिभावक(?: का नाम)?"]);
  const address = labelled(text, ["(?:residential |permanent )?address", "पता"]);
  const authority = labelled(text, ["issuing authority", "issued by", "school", "board", "जारीकर्ता"]);

  if (name && name.length < 80) fields.name = name;
  if (dob) fields.date_of_birth = dob;
  if (guardian && guardian.length < 100) fields.guardian_name = guardian;
  if (address) fields.address = address;
  if (authority && authority.length < 100) fields.issuing_authority = authority;

  const type = declaredType.toLowerCase();
  const number = type.includes("pan")
    ? firstMatch(text, [/\b([A-Z]{5}\d{4}[A-Z])\b/])
    : type.includes("aadhaar")
      ? firstMatch(text, [/\b(\d{4}\s\d{4}\s\d{4})\b/])
      : type.includes("voter")
        ? firstMatch(text, [/\b([A-Z]{3}\d{7})\b/])
        : labelled(text, ["(?:document|certificate|registration|roll|serial|admission) (?:no\\.?|number)", "क्रमांक", "पंजीकरण संख्या"]);
  if (number) fields.document_number = number;
  return sanitizeExtractedFields(fields, declaredType);
}

export async function parseDocumentLocally(bytes: ArrayBuffer, mimeType: string, declaredType: string, browserOcrText = ""): Promise<LocalExtraction> {
  const text = browserOcrText.trim();
  const notes: string[] = [];
  void bytes; void mimeType;

  const fields = fieldsFromText(text, declaredType);
  if (!text) notes.push("No embedded text was found; review manually if AI OCR is unavailable.");
  else if (!Object.keys(fields).length) notes.push("Text was read locally, but no identity field could be mapped confidently; review manually.");
  const confidence = Math.min(0.78, text ? 0.3 + Object.keys(fields).length * 0.09 : 0);
  return {
    fields,
    signature: { present: /\bsign(?:ed|ature)?\b|हस्ताक्षर/i.test(text), confidence: text ? 0.45 : 0 },
    stamp: { present: /\b(?:stamp|seal)\b|मुहर/i.test(text), confidence: text ? 0.45 : 0 },
    confidence,
    conflicts: [],
    notes,
    text: text.slice(0, 30_000),
  };
}
