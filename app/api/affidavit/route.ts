import fontkit from "@pdf-lib/fontkit";
import devanagariUrl from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2?url";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { errorResponse, requireAccount } from "@/lib/server";

type CaseRecord = { id: string; service: string; state: string; district: string; profile: Record<string, unknown> };
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate; else { if (line) lines.push(line); line = word; } }
  if (line) lines.push(line); return lines;
}

export async function POST(request: Request) {
  try {
    await requireAccount(request); const { caseRecord, language } = await request.json() as { caseRecord: CaseRecord; language: "en" | "hi" };
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); const page = pdf.addPage([595.28, 841.89]); const { width, height } = page.getSize();
    const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); let hindi: PDFFont | null = null;
    if (language === "hi") { const fontResponse = await fetch(new URL(devanagariUrl, request.url)); if (fontResponse.ok) hindi = await pdf.embedFont(await fontResponse.arrayBuffer(), { subset: true }); }
    const bodyFont = language === "hi" && hindi ? hindi : regular; const ink = rgb(0.09, 0.14, 0.24); const muted = rgb(0.37, 0.4, 0.46); const indigo = rgb(0.14, 0.25, 0.52); let y = height - 58;
    page.drawRectangle({ x: 0, y: height - 18, width, height: 18, color: indigo }); page.drawText("NEEV  |  DRAFT FOR REVIEW", { x: 48, y, size: 9, font: bold, color: indigo }); y -= 38;
    page.drawText(language === "hi" ? "शपथपत्र का मसौदा" : "DRAFT AFFIDAVIT", { x: 48, y, size: language === "hi" ? 22 : 20, font: bodyFont, color: ink }); y -= 22;
    page.drawText(`Case ID: ${caseRecord.id}   |   Purpose: ${caseRecord.service}`, { x: 48, y, size: 9, font: regular, color: muted }); y -= 34;
    const name = String(caseRecord.profile.name || "________________"); const dob = String(caseRecord.profile.dob || "________________"); const address = String(caseRecord.profile.address || `${caseRecord.district || "________________"}, ${caseRecord.state || "________________"}`);
    const paragraphs = language === "hi" ? [
      `मैं, ${name}, जन्मतिथि ${dob}, निवासी ${address}, सत्यनिष्ठा से यह घोषित करता/करती हूँ कि इस मसौदे में दी गई जानकारी मेरे ज्ञान और उपलब्ध अभिलेखों के अनुसार सत्य है।`,
      `यह मसौदा ${caseRecord.service} से संबंधित पहचान अभिलेखों में सहायता के उद्देश्य से तैयार किया गया है। अंतिम भाषा, स्टाम्प शुल्क, गवाह, नोटरी और सक्षम प्राधिकारी की आवश्यकताएँ स्थानीय नियमों के अनुसार सत्यापित की जानी चाहिए।`,
      "मैं समझता/समझती हूँ कि यह कंप्यूटर द्वारा तैयार मसौदा है, स्वयं शपथपत्र या सरकारी स्वीकृति नहीं। हस्ताक्षर करने से पहले वकील, नोटरी या संबंधित कार्यालय से इसकी जाँच करवाना आवश्यक है।",
    ] : [
      `I, ${name}, date of birth ${dob}, residing at ${address}, solemnly state that the information in this draft is true to the best of my knowledge and based on the records presently available to me.`,
      `This draft is prepared to support identity-record work connected with ${caseRecord.service}. The final wording, stamp duty, witnesses, notarisation and competent-authority requirements must be checked under the applicable local rules.`,
      "I understand that this is a computer-generated draft for review. It is not a sworn affidavit, legal advice or evidence of government acceptance until completed and executed as required by the competent authority.",
    ];
    for (const paragraph of paragraphs) { for (const line of wrap(paragraph, bodyFont, 11, width - 96)) { page.drawText(line, { x: 48, y, size: 11, font: bodyFont, color: ink }); y -= 18; } y -= 13; }
    y -= 18; page.drawLine({ start: { x: 48, y }, end: { x: 225, y }, thickness: 0.7, color: muted }); page.drawLine({ start: { x: 355, y }, end: { x: 532, y }, thickness: 0.7, color: muted }); y -= 15;
    page.drawText(language === "hi" ? "स्थान और दिनांक" : "Place and date", { x: 48, y, size: language === "hi" ? 9 : 9, font: bodyFont, color: muted }); page.drawText(language === "hi" ? "घोषणाकर्ता के हस्ताक्षर" : "Signature of deponent", { x: 355, y, size: language === "hi" ? 9 : 9, font: bodyFont, color: muted });
    page.drawRectangle({ x: 40, y: 36, width: width - 80, height: 48, borderColor: rgb(0.85, 0.55, 0.26), borderWidth: 0.8, color: rgb(1, 0.97, 0.9) }); page.drawText("IMPORTANT: REVIEW WITH THE NOTARY / COMPETENT OFFICE BEFORE SIGNING.", { x: 53, y: 62, size: 8.5, font: bold, color: rgb(0.55, 0.34, 0.12) }); page.drawText("Generated from user-confirmed case data. Neev does not certify facts or guarantee acceptance.", { x: 53, y: 47, size: 8, font: regular, color: rgb(0.45, 0.35, 0.23) });
    const bytes = await pdf.save(); const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; return new Response(body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${caseRecord.id}-draft-affidavit.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
