#!/usr/bin/env node
import {
  coachMessage,
  scorePrompt,
} from "@vaultcompass/conductor-core";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error("Usage: conductor-coach <prompt text>");
  process.exit(1);
}

const scored = scorePrompt(text);
const message = coachMessage(scored, text);
console.log(
  JSON.stringify({
    score: scored.score,
    issues: scored.issues,
    coaching: message,
    needs_coaching: scored.score < 60 || scored.issues.length > 0,
  }),
);
