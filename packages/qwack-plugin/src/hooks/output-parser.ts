export interface ParsedProposal {
  type: "propose";
  content: string;
}

export interface ParsedDisagreement {
  type: "disagree";
  severity: "minor" | "major";
  content: string;
}

export type ParsedInteraction = ParsedProposal | ParsedDisagreement;

export interface ParseResult {
  /** The text with all markers stripped out */
  cleanText: string;
  /** Any interactions found in the text */
  interactions: ParsedInteraction[];
}

/**
 * Parse agent output text for QWACK interaction markers.
 *
 * Supported markers:
 *   [QWACK:PROPOSE]content[/QWACK:PROPOSE]
 *   [QWACK:DISAGREE:minor]content[/QWACK:DISAGREE]
 *   [QWACK:DISAGREE:major]content[/QWACK:DISAGREE]
 *
 * Returns cleaned text (markers removed) and parsed interactions.
 */
export function parseAgentOutput(text: string): ParseResult {
  const interactions: ParsedInteraction[] = [];
  let cleanText = text;

  const proposeRegex =
    /\[QWACK:PROPOSE\]\s*([\s\S]*?)\s*\[\/QWACK:PROPOSE\]/g;
  for (const match of text.matchAll(proposeRegex)) {
    interactions.push({ type: "propose", content: match[1].trim() });
  }
  cleanText = cleanText.replace(proposeRegex, "");

  const disagreeRegex =
    /\[QWACK:DISAGREE:(minor|major)\]\s*([\s\S]*?)\s*\[\/QWACK:DISAGREE\]/g;
  for (const match of text.matchAll(disagreeRegex)) {
    interactions.push({
      type: "disagree",
      severity: match[1] as "minor" | "major",
      content: match[2].trim(),
    });
  }
  cleanText = cleanText.replace(disagreeRegex, "");

  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText, interactions };
}
