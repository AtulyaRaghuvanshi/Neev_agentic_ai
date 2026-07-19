export type RuleEntry = {
  id: string; service: string; states: string[]; requires: string[]; keywords: string[];
  title: { en: string; hi: string }; guidance: { en: string; hi: string };
  office: string; officialUrl: string; sourceUrl: string; verifiedOn: string;
  actions?: { kind: "document" | "locator"; label: { en: string; hi: string }; url?: string; artifact?: "affidavit" }[];
};

export const RULES: RuleEntry[] = [
  {
    id: "uidai-document-enrolment", service: "Aadhaar enrolment", states: ["ALL"], requires: ["poi", "poa"], keywords: ["aadhaar", "identity", "address", "poi", "poa"],
    title: { en: "Use document-based Aadhaar enrolment", hi: "दस्तावेज़ आधारित आधार नामांकन करें" },
    guidance: { en: "UIDAI's document route requires an accepted proof of identity and proof of address. Check the current schedule before visiting because acceptance categories can change.", hi: "UIDAI के दस्तावेज़ मार्ग में मान्य पहचान और पते का प्रमाण चाहिए। जाने से पहले वर्तमान सूची जाँचें।" },
    office: "Aadhaar enrolment centre", officialUrl: "https://bhuvan.nrsc.gov.in/", sourceUrl: "https://uidai.gov.in/images/commdoc/List_of_Supporting_Document_for_Aadhaar_Enrolment_and_Update.pdf", verifiedOn: "2026-07-18",
    actions: [{ kind: "locator", label: { en: "Find Aadhaar centre", hi: "आधार केंद्र खोजें" }, url: "https://bhuvan.nrsc.gov.in/" }],
  },
  {
    id: "uidai-hof-enrolment", service: "Aadhaar enrolment", states: ["ALL"], requires: ["por", "hof"], keywords: ["head of family", "hof", "relationship", "no identity"],
    title: { en: "Check Head of Family enrolment", hi: "परिवार के मुखिया वाला नामांकन जाँचें" },
    guidance: { en: "When the resident lacks individual PoI/PoA, UIDAI permits a Head of Family route where an accepted proof of relationship identifies both people. The HoF must participate as required by UIDAI.", hi: "व्यक्तिगत पहचान/पता प्रमाण न होने पर UIDAI मान्य संबंध प्रमाण के साथ परिवार के मुखिया वाला मार्ग देता है।" },
    office: "Aadhaar enrolment centre", officialUrl: "https://bhuvan.nrsc.gov.in/", sourceUrl: "https://uidai.gov.in/en/36a7399890.html", verifiedOn: "2026-07-18",
    actions: [{ kind: "locator", label: { en: "Find Aadhaar centre", hi: "आधार केंद्र खोजें" }, url: "https://bhuvan.nrsc.gov.in/" }],
  },
  {
    id: "bihar-residence", service: "Residence certificate", states: ["Bihar"], requires: [], keywords: ["bihar", "residence", "address", "rtps"],
    title: { en: "Apply for a Bihar residence certificate", hi: "बिहार आवासीय प्रमाणपत्र के लिए आवेदन करें" },
    guidance: { en: "Bihar's official ServicePlus portal accepts online submissions for residence certificate services. The issuing authority performs final verification.", hi: "बिहार का आधिकारिक ServicePlus पोर्टल आवासीय प्रमाणपत्र के ऑनलाइन आवेदन स्वीकार करता है।" },
    office: "Bihar ServicePlus / RTPS", officialUrl: "https://serviceonline.bihar.gov.in/", sourceUrl: "https://serviceonline.bihar.gov.in/", verifiedOn: "2026-07-18",
  },
  {
    id: "delayed-birth", service: "Birth certificate", states: ["ALL"], requires: ["local_birth_evidence"], keywords: ["birth", "delayed", "not registered", "non availability"],
    title: { en: "Start delayed birth registration", hi: "विलंबित जन्म पंजीकरण शुरू करें" },
    guidance: { en: "Births not reported within the ordinary period use the delayed-registration route under the Registration of Births and Deaths framework. The exact authority, evidence and fee follow the applicable state rules, so confirm locally before filing.", hi: "समय पर पंजीकृत न हुए जन्म के लिए विलंबित पंजीकरण प्रक्रिया लागू होती है। अधिकारी, प्रमाण और शुल्क राज्य के नियमों से तय होते हैं।" },
    office: "Local Registrar of Births and Deaths", officialUrl: "https://dc.crsorgi.gov.in/", sourceUrl: "https://dc.crsorgi.gov.in/assets/download/FAQ_of_CRS_Latest.pdf", verifiedOn: "2026-07-18",
  },
];

export function retrieveRules(service: string, state: string, text = "") {
  const query = `${service} ${state} ${text}`.toLowerCase();
  return RULES.filter((rule) => rule.service === service)
    .filter((rule) => rule.states.includes("ALL") || rule.states.includes(state))
    .map((rule) => ({ rule, score: (rule.service === service ? 3 : 0) + rule.keywords.filter((keyword) => query.includes(keyword)).length + (rule.states.includes(state) ? 2 : 0) }))
    .sort((a, b) => b.score - a.score).map(({ rule }) => rule);
}
