import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { retrieveRules, RuleEntry } from "@/lib/rules";
import { runTextAI } from "@/lib/server";
import { parseTodoLines } from "@/lib/domain";

export type PlanAction = { kind: "document" | "locator"; label: string; url?: string; artifact?: "affidavit" };
export type PlanStep = { id: string; title: string; description: string; office: string; url?: string; source?: string; actions?: PlanAction[]; basis: "rule" | "ai"; state: "ready" | "locked" | "complete" };
type CaseRecord = { id: string; service: string; state: string; district: string; language: "en" | "hi"; profile: Record<string, unknown>; documents?: unknown[] };
type AgentOutputs = {
  documentAgent: { available: boolean; artifact?: "draft-affidavit-pdf" };
  appointmentAgent: { booked: false; reason: string; locator?: string };
  submissionAgent: { checklist: string[] };
  notificationAgent: { enabled: false; reason: string };
};

const PathwayState = Annotation.Root({
  caseRecord: Annotation<CaseRecord>,
  rules: Annotation<RuleEntry[]>({ default: () => [], reducer: (_, next) => next }),
  steps: Annotation<PlanStep[]>({ default: () => [], reducer: (_, next) => next }),
  retrievalMode: Annotation<"structured-official-rules" | "ai-fallback">,
  warnings: Annotation<string[]>({ default: () => [], reducer: (left, right) => [...left, ...right] }),
  agents: Annotation<AgentOutputs>,
});

function buildFromRules(caseRecord: CaseRecord, rules: RuleEntry[]) {
  const language = caseRecord.language || "en"; const documents = caseRecord.profile.documents as string[] || [];
  const hasIdentity = documents.some((document) => ["Voter ID", "PAN card", "Aadhaar"].includes(document));
  const hasAddress = documents.some((document) => ["Ration card", "Voter ID", "Aadhaar", "Panchayat record"].includes(document));
  const steps: PlanStep[] = [];
  if (caseRecord.service === "Aadhaar enrolment" && !(hasIdentity && hasAddress)) {
    const residence = retrieveRules("Residence certificate", caseRecord.state)[0];
    if (residence) steps.push(toPlanStep(residence, language, "ready"));
    const hof = rules.find((rule) => rule.id === "uidai-hof-enrolment");
    if (hof) steps.push(toPlanStep(hof, language, steps.length ? "locked" : "ready"));
    const enrolment = rules.find((rule) => rule.id === "uidai-document-enrolment");
    if (enrolment) steps.push({ ...toPlanStep(enrolment, language, "locked"), title: language === "en" ? "Complete Aadhaar enrolment" : "आधार नामांकन पूरा करें" });
    return steps;
  }
  return rules.slice(0, 4).map((rule, index) => toPlanStep(rule, language, index === 0 ? "ready" : "locked"));
}

function toPlanStep(rule: RuleEntry, language: "en" | "hi", state: PlanStep["state"]): PlanStep {
  return { id: rule.id, title: rule.title[language], description: rule.guidance[language], office: rule.office, url: rule.officialUrl, source: rule.sourceUrl, actions: rule.actions?.map((action) => ({ ...action, label: action.label[language] })), basis: "rule", state };
}

const retrieveNode = (state: typeof PathwayState.State) => ({ rules: retrieveRules(state.caseRecord.service, state.caseRecord.state, JSON.stringify(state.caseRecord.profile)) });
const planNode = async (state: typeof PathwayState.State) => {
  const deterministic = buildFromRules(state.caseRecord, state.rules); if (deterministic.length) return { steps: deterministic, retrievalMode: "structured-official-rules" as const };
  const documents = state.caseRecord.documents || [];
  const heldDocuments = [...new Set([...(state.caseRecord.profile.documents as string[] || []), ...documents.map((document) => String((document as { type?: string }).type || "")).filter(Boolean)])];
  const limitations = [...new Set([String(state.caseRecord.profile.story || "").trim(), ...documents.map((document) => String((document as { issue?: string }).issue || "").trim())].filter(Boolean))];
  const answer = await runTextAI({ prompt: `I currently have these documents: ${heldDocuments.length ? heldDocuments.join(", ") : "none confirmed"}.
I want to obtain: ${state.caseRecord.service}.
My location is: ${state.caseRecord.district || "district not provided"}, ${state.caseRecord.state || "state not provided"}.
My limitations, if any: ${limitations.length ? limitations.join("; ") : "none provided"}.

Give only ONE route to obtain the requested document. Do not assume missing facts. Do not give alternatives. Do not over-explain. Return few short lines in the exact format "TODO: next move". No heading, introduction, conclusion, markdown table, or invented address/URL. If a missing fact prevents a reliable next move, make the first TODO tell me which relevant official authority must confirm it. Write in ${state.caseRecord.language === "hi" ? "Hindi" : "English"}.` });
  const todos = parseTodoLines(answer);
  if (!todos.length) throw new Error("The AI planner returned no TODO steps");
  return { retrievalMode: "ai-fallback" as const, steps: todos.map((todo, index) => ({ id: `fallback-${index}`, title: todo, description: "", office: "", basis: "ai" as const, state: index === 0 ? "ready" as const : "locked" as const })) };
};
function official(url?: string) { if (!url) return undefined; try { const host = new URL(url).hostname; return host.endsWith(".gov.in") || host === "uidai.gov.in" || host.endsWith(".uidai.gov.in") || host === "bhuvan.nrsc.gov.in" ? url : undefined; } catch { return undefined; } }
const verifyNode = (state: typeof PathwayState.State) => {
  const warnings: string[] = []; let readyFound = false; const steps: PlanStep[] = state.steps.map((step) => { const url = official(step.url); const source = official(step.source); const actions = step.actions?.map((action) => ({ ...action, url: official(action.url) })).filter((action) => action.kind === "document" || Boolean(action.url)); if (step.url && !url) warnings.push(`Removed unverified service URL from ${step.id}`); if (step.source && !source) warnings.push(`Removed unverified source URL from ${step.id}`); const nextState: PlanStep["state"] = step.state === "complete" ? "complete" : !readyFound && step.state === "ready" ? "ready" : "locked"; if (nextState === "ready") readyFound = true; return { ...step, url, source, actions, state: nextState }; }); return { steps, warnings };
};
const dispatchNode = (state: typeof PathwayState.State) => ({ agents: {
  documentAgent: state.steps.some((step) => step.actions?.some((action) => action.kind === "document" && action.artifact === "affidavit")) ? { available: true, artifact: "draft-affidavit-pdf" as const } : { available: false },
  appointmentAgent: { booked: false as const, reason: "No reliable free booking API is available; a verified locator is shown only when this pathway requires one.", locator: state.steps.flatMap((step) => step.actions || []).find((action) => action.kind === "locator")?.url },
  submissionAgent: { checklist: ["Original user-confirmed evidence", ...state.steps.map((step) => step.title)] },
  notificationAgent: { enabled: false as const, reason: "Disabled in the free MVP; case progress remains visible after sign-in." },
} });

const pathwayGraph = new StateGraph(PathwayState).addNode("retrieve_rules", retrieveNode).addNode("plan_dependencies", planNode).addNode("verify_claims", verifyNode).addNode("dispatch_agents", dispatchNode).addEdge(START, "retrieve_rules").addEdge("retrieve_rules", "plan_dependencies").addEdge("plan_dependencies", "verify_claims").addEdge("verify_claims", "dispatch_agents").addEdge("dispatch_agents", END).compile();

export async function orchestratePathway(caseRecord: CaseRecord) { return pathwayGraph.invoke({ caseRecord }); }
