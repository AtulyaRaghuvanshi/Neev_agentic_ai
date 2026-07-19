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
  return fields;
}

export async function parseDocumentLocally(bytes: ArrayBuffer, mimeType: string, declaredType: string, browserOcrText = ""): Promise<LocalExtraction> {
  let text = browserOcrText.trim();
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
