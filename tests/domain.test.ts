import assert from "node:assert/strict";
import test from "node:test";
import { parseTodoLines, resolveEvidence, similarity, unlockNext } from "../lib/domain.ts";
import { retrieveRules } from "../lib/rules.ts";
import { mergeExtractedFields, parseDocumentLocally, sanitizeExtractedFields } from "../lib/document-parser.ts";

test("fuzzy evidence matching tolerates a small spelling variation", () => {
  assert.ok(similarity("Shiva Kumar", "Siva Kumar") > 0.88);
  assert.ok(similarity("Shiva Kumar", "Ramesh Singh") < 0.5);
});

test("evidence resolution selects the best-supported value and flags a conflict", () => {
  const graph = resolveEvidence([
    { id: "school", confidence: 0.93, fields: { name: "Shiva Kumar" } },
    { id: "ration", confidence: 0.85, fields: { name: "Siva Kumar" } },
    { id: "employer", confidence: 0.7, fields: { name: "Ramesh Kumar" } },
  ]);
  assert.equal(graph.name.selected.value, "Shiva Kumar"); assert.equal(graph.name.conflict, true);
});

test("planner unlocks exactly the immediate next dependency", () => {
  const steps = unlockNext([{ state: "ready" as const }, { state: "locked" as const }, { state: "locked" as const }], 0);
  assert.deepEqual(steps.map((step) => step.state), ["complete", "ready", "locked"]);
});

test("retrieval prefers Bihar's official residence rule", () => {
  assert.equal(retrieveRules("Residence certificate", "Bihar")[0]?.id, "bihar-residence");
});

test("retrieval does not substitute an Aadhaar rule for a Voter ID request", () => {
  assert.deepEqual(retrieveRules("Voter ID", "Uttar Pradesh", "I already have Aadhaar"), []);
});

test("open-source OCR text maps identity fields without an AI key", async () => {
  const result = await parseDocumentLocally(new ArrayBuffer(0), "image/png", "PAN card", "Name: Atulya Raghuvanshi\nDate of Birth: 01/02/2000\nABCDE1234F");
  assert.equal(result.fields.name, "Atulya Raghuvanshi");
  assert.equal(result.fields.date_of_birth, "01/02/2000");
  assert.equal(result.fields.document_number, "ABCDE1234F");
  assert.ok(result.confidence > 0.5);
});

test("PAN extraction rejects OCR label fragments and impossible dates", () => {
  assert.deepEqual(sanitizeExtractedFields({ name: "Name Lar", date_of_birth: "Jog", guardian_name: "/ Father's Name उक्त रकम का", document_number: "GQHPR8016L", issuing_authority: "INCOME TAX DEPARTMENT GOVT. OF INDIA" }, "PAN card"), {
    document_number: "GQHPR8016L",
    issuing_authority: "INCOME TAX DEPARTMENT GOVT. OF INDIA",
  });
});

test("vision fields take priority while valid OCR only fills omissions", () => {
  assert.deepEqual(mergeExtractedFields({ name: "Ravi Kumar", date_of_birth: "17/07/2003" }, { name: "Name Lar", date_of_birth: "Jog", document_number: "GQHPR8016L" }, "PAN card"), {
    document_number: "GQHPR8016L",
    name: "Ravi Kumar",
    date_of_birth: "17/07/2003",
  });
});

test("plain LLM TODO output becomes concise pathway steps", () => {
  assert.deepEqual(parseTodoLines("TODO: Confirm accepted school certificate\n- [ ] Visit the issuing authority\n3. Submit the application"), ["Confirm accepted school certificate", "Visit the issuing authority", "Submit the application"]);
});
