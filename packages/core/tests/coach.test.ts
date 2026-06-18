import { describe, it, expect } from "vitest";
import { scorePrompt, coachMessage } from "../src/coach.js";

describe("scorePrompt", () => {
  it("penalizes product_stack and scope_adverb patterns", () => {
    const result = scorePrompt(
      "Just quickly add export like Notion with sharing and PDF too",
    );
    expect(result.score).toBeLessThan(60);
    expect(result.issues).toContain("product_stack");
    expect(result.issues).toContain("scope_adverb");
  });

  it("scores a clear prompt higher", () => {
    const result = scorePrompt(
      "Add CSV export for the fund table. Client-side only. No PDF.",
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.issues).toHaveLength(0);
  });
});

describe("coachMessage", () => {
  it("returns rewrite suggestion for low scores", () => {
    const scored = scorePrompt("Just quickly rebuild everything like Notion");
    const msg = coachMessage(scored, "Just quickly rebuild everything like Notion");
    expect(msg).toContain("Prompt variance");
    expect(msg).toContain("Suggested rewrite");
  });
});
