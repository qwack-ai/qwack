import { describe, expect, test } from "bun:test";
import { parseAgentOutput } from "./output-parser";

describe("parseAgentOutput", () => {
  // 1. Text with no markers returns unchanged text and empty interactions
  test("returns unchanged text and empty interactions when no markers", () => {
    const input = "Just some plain agent output.\nNothing special here.";
    const result = parseAgentOutput(input);
    expect(result.cleanText).toBe(input);
    expect(result.interactions).toEqual([]);
  });

  // 2. Single proposal is parsed correctly
  test("parses a single proposal", () => {
    const input = "[QWACK:PROPOSE]Use connection pooling[/QWACK:PROPOSE]";
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]).toEqual({
      type: "propose",
      content: "Use connection pooling",
    });
  });

  // 3. Proposal content is trimmed of whitespace
  test("trims whitespace from proposal content", () => {
    const input =
      "[QWACK:PROPOSE]\n  Use connection pooling  \n[/QWACK:PROPOSE]";
    const result = parseAgentOutput(input);
    expect(result.interactions[0].content).toBe("Use connection pooling");
  });

  // 4. Single minor disagreement is parsed correctly
  test("parses a minor disagreement", () => {
    const input =
      "[QWACK:DISAGREE:minor]Consider RS256 over HS256[/QWACK:DISAGREE]";
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]).toEqual({
      type: "disagree",
      severity: "minor",
      content: "Consider RS256 over HS256",
    });
  });

  // 5. Single major disagreement is parsed correctly
  test("parses a major disagreement", () => {
    const input =
      "[QWACK:DISAGREE:major]This approach has a SQL injection vulnerability[/QWACK:DISAGREE]";
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]).toEqual({
      type: "disagree",
      severity: "major",
      content: "This approach has a SQL injection vulnerability",
    });
  });

  // 6. Severity is correctly extracted
  test("distinguishes minor from major severity", () => {
    const input = [
      "[QWACK:DISAGREE:minor]Nitpick[/QWACK:DISAGREE]",
      "[QWACK:DISAGREE:major]Critical issue[/QWACK:DISAGREE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions[0].type === "disagree" && result.interactions[0].severity).toBe("minor");
    expect(result.interactions[1].type === "disagree" && result.interactions[1].severity).toBe("major");
  });

  // 7. Multiple markers in one text are all parsed
  test("parses multiple markers from one text", () => {
    const input = [
      "Here is my analysis.",
      "",
      "[QWACK:PROPOSE]",
      "Add rate limiting to the refresh endpoint.",
      "This prevents token refresh abuse.",
      "[/QWACK:PROPOSE]",
      "",
      "I'll proceed with the implementation.",
      "",
      "[QWACK:DISAGREE:minor]",
      "Consider using RS256 instead of HS256 for JWT signing.",
      "RS256 allows public key verification without sharing the secret.",
      "[/QWACK:DISAGREE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions[0].type).toBe("propose");
    expect(result.interactions[0].content).toBe(
      "Add rate limiting to the refresh endpoint.\nThis prevents token refresh abuse.",
    );
    expect(result.interactions[1].type).toBe("disagree");
    expect(result.interactions[1].content).toBe(
      "Consider using RS256 instead of HS256 for JWT signing.\nRS256 allows public key verification without sharing the secret.",
    );
  });

  // 8. Markers are stripped from cleanText
  test("strips markers from cleanText", () => {
    const input =
      "Before.[QWACK:PROPOSE]suggestion[/QWACK:PROPOSE]After.";
    const result = parseAgentOutput(input);
    expect(result.cleanText).toBe("Before.After.");
    expect(result.cleanText).not.toContain("QWACK");
  });

  // 9. cleanText doesn't have excessive blank lines after stripping
  test("collapses excessive blank lines in cleanText", () => {
    const input = [
      "Here is my analysis.",
      "",
      "[QWACK:PROPOSE]",
      "Add rate limiting to the refresh endpoint.",
      "This prevents token refresh abuse.",
      "[/QWACK:PROPOSE]",
      "",
      "I'll proceed with the implementation.",
      "",
      "[QWACK:DISAGREE:minor]",
      "Consider using RS256 instead of HS256 for JWT signing.",
      "RS256 allows public key verification without sharing the secret.",
      "[/QWACK:DISAGREE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.cleanText).toBe(
      "Here is my analysis.\n\nI'll proceed with the implementation.",
    );
    expect(result.cleanText).not.toMatch(/\n{3,}/);
  });

  // 10. Nested/adjacent markers work correctly
  test("handles adjacent markers", () => {
    const input = [
      "[QWACK:PROPOSE]First suggestion[/QWACK:PROPOSE]",
      "[QWACK:PROPOSE]Second suggestion[/QWACK:PROPOSE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions[0].content).toBe("First suggestion");
    expect(result.interactions[1].content).toBe("Second suggestion");
  });

  // 11. Text before and after markers is preserved in cleanText
  test("preserves surrounding text in cleanText", () => {
    const input =
      "Start of output.\n\n[QWACK:DISAGREE:major]Bad idea[/QWACK:DISAGREE]\n\nEnd of output.";
    const result = parseAgentOutput(input);
    expect(result.cleanText).toBe("Start of output.\n\nEnd of output.");
  });

  // 12. Empty marker content works
  test("handles empty marker content", () => {
    const input = "[QWACK:PROPOSE][/QWACK:PROPOSE]";
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].content).toBe("");
  });

  // 13. Mixed proposals and disagreements in any order
  test("handles mixed marker types in any order", () => {
    const input = [
      "[QWACK:DISAGREE:major]Stop[/QWACK:DISAGREE]",
      "[QWACK:PROPOSE]Do this instead[/QWACK:PROPOSE]",
      "[QWACK:DISAGREE:minor]Also consider[/QWACK:DISAGREE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.interactions).toHaveLength(3);
    // Proposals parsed first, then disagreements
    expect(result.interactions[0].type).toBe("propose");
    expect(result.interactions[1].type).toBe("disagree");
    expect(result.interactions[2].type).toBe("disagree");
  });

  // 14. Multiline content inside markers
  test("preserves multiline content inside markers", () => {
    const input = [
      "[QWACK:PROPOSE]",
      "Line one.",
      "Line two.",
      "Line three.",
      "[/QWACK:PROPOSE]",
    ].join("\n");
    const result = parseAgentOutput(input);
    expect(result.interactions[0].content).toBe(
      "Line one.\nLine two.\nLine three.",
    );
  });
});
