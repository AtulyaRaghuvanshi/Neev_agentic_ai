import { orchestratePathway } from "@/lib/orchestrator";
import { errorResponse, json, requireAccount } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await requireAccount(request); const { caseRecord } = await request.json(); const result = await orchestratePathway(caseRecord);
    return json({ steps: result.steps, agents: result.agents, retrieval: { ruleIds: result.rules.map((rule) => rule.id), mode: result.retrievalMode, verifiedOn: result.rules.map((rule) => rule.verifiedOn), warnings: result.warnings } });
  } catch (error) { return errorResponse(error); }
}
