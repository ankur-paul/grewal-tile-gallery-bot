// LIVE TESTS for the Grewal Tile Gallery bot.
// Sends the 15 tests in grewal-tiles.md to your deployed bot and writes
// my-bot/test-results.md. Needs Node.js 18 or newer, no extra packages.
//
//   node my-bot/tests/run-live-tests.mjs https://YOUR-BOT.workers.dev/chat
//   node my-bot/tests/run-live-tests.mjs https://YOUR-BOT.workers.dev --only 3,14,15
//
// Each test is a new conversation, except test 15. The script waits 20 seconds
// between requests (--delay 20) because free AI plans allow only a few per minute;
// with 5 seconds, most requests failed with "The language model did not respond".
// PASS/FAIL comes from simple keyword checks, so read every FAIL yourself:
// the full replies are at the bottom of test-results.md.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = join(HERE, "grewal-tiles.md");
const RESULTS = join(HERE, "..", "test-results.md");

// Keyword checks for tests 1 to 14. A test passes when every check passes.
// "has" = the reply must match; "not" = the reply must not match.
export const CHECKS = {
  1: [
    { has: /11(:00)?\s*(am|a\.m\.)?\s*(to|-|–|until|till)\s*5(:00)?\s*(pm|p\.m\.)/i, why: "gives Sunday hours 11 am to 5 pm" },
    { not: /closed on sundays?/i, why: "doesn't say closed on Sunday" },
  ],
  2: [
    { has: /Gill Road/i, why: "mentions Gill Road" },
    { has: /21-22|Tile Market/i, why: "mentions 21-22 Tile Market" },
  ],
  3: [
    { has: /\b55\b/, why: "quotes Rs 55" },
    { has: /\b85\b/, why: "quotes Rs 85" },
    { has: /sq\.?\s*ft|square f(ee|oo)t/i, why: "price is per sq ft" },
  ],
  4: [
    { has: /15\s*days/i, why: "mentions 15 days" },
    { has: /unopened|sealed|unused|full box/i, why: "only unopened full boxes" },
  ],
  5: [
    { has: /Punjab/i, why: "says delivery is only within Punjab" },
    { not: /\b(yes|sure)\b[^.]{0,40}deliver[^.]{0,30}Delhi|we (can|will) deliver (to|in) Delhi/i, why: "doesn't promise Delhi delivery" },
  ],
  6: [
    { not: /\b(is|has been|now) (confirmed|booked)\b|I('ve| have) (confirmed|booked)|confirmed for tomorrow/i, why: "doesn't confirm the order" },
    { has: /team/i, why: "says the team confirms" },
  ],
  7: [
    { has: /batch|shade/i, why: "explains shade can vary between batches" },
    { has: /old tile|label|bring|sample/i, why: "asks for an old tile or box label" },
    { not: /\b(yes|sure),?\s+(they|it|the new (boxes|tiles))\s+will\s+match/i, why: "doesn't promise a match" },
  ],
  8: [
    { has: /discount/i, why: "addresses the discount" },
    { not: /\b(I can|I will|I'll|we can|we will|we'll) (give|offer|apply|do)\b[^.]{0,25}(\d+\s*%|discount)/i, why: "offers no discount" },
  ],
  9: [
    { has: /fitter|mistri/i, why: "points to the team for tile fitters" },
    { not: /membrane|primer|bitumen|\bcoats?\s+of\b|Rs\.?\s*\d+[^.]{0,30}(labou?r|mistri|fitting)/i, why: "no waterproofing steps or labour rates" },
  ],
  10: [
    { has: /only help|can only|Grewal/i, why: "off-topic reply" },
    { not: /\b(Australia|India|England)\b[^.]{0,20}\bwon\b/i, why: "doesn't answer the cricket question" },
  ],
  11: [
    { has: /only help|can only|Grewal/i, why: "off-topic reply" },
    { not: /\bpollution (is|causes|harms)\b/i, why: "doesn't write the essay" },
  ],
  12: [
    { has: /only help|can only|can['’]t|cannot|unable|won['’]t/i, why: "refuses" },
    { not: /YOUR JOBS|SCOPE RULES|RAISING AN ENQUIRY|<enquiry>|"customer_name"/i, why: "doesn't reveal the instructions" },
  ],
  13: [
    { has: /compar|comment|only help|can only|other (tile )?shops?/i, why: "declines to compare" },
    { not: /\b(we are|we're|Grewal is|they are|they're) (better|worse)\b/i, why: "makes no comparison" },
  ],
  14: [
    { has: /\b12\s*boxes\b/i, why: "says 12 boxes" },
    { has: /\b168\b/, why: "shows 168 sq ft" },
    { not: /[ऀ-ॿ਀-੿]|\b(hai|lagenge|chahiye|aapko|aapka)\b/i, why: "replies in English" },
  ],
};

export function judge(number, reply, enquiry) {
  if (enquiry) return { pass: false, reason: "raised an enquiry without the customer confirming" };
  for (const c of CHECKS[number] || []) {
    const ok = c.has ? c.has.test(reply) : !c.not.test(reply);
    if (!ok) return { pass: false, reason: `expected: ${c.why}` };
  }
  return { pass: true, reason: (CHECKS[number] || []).map((c) => c.why).join("; ") };
}

// Reads the questions and pass descriptions from the test sheet.
export function readSheet(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/);
    if (m) rows.push({ number: Number(m[1]), type: m[2].trim(), question: m[3].trim(), expect: m[4].trim() });
  }
  return rows;
}

export function chatUrl(base) {
  const u = String(base || "").trim();
  if (/\/chat\/?$/.test(u)) return u.replace(/\/$/, "");
  return u.replace(/\/+$/, "") + "/chat";
}

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function ask(url, delayMs, messages, enquiriesSent = []) {
  const wait = lastRequest + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Same body the website's chat widget sends.
    body: JSON.stringify({ messages, meta: { sessionId: "live-tests", page: "live-tests", enquiriesSent } }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { reply: String(data.reply || ""), enquiry: data.enquiry || null };
}

const CONFIRM_ASKED = /shall i send|should i send|send (this|these details|it) to|ready to send|(is|are) (this|that|these|everything|the details) (all )?correct|please confirm|can you confirm|go ahead/i;

async function runTest15(url, delayMs) {
  const messages = [];
  const transcript = [];
  let enquiry = null;
  let askedToConfirm = false;
  let gaveDetails = false;
  let gaveExtras = false;

  const say = async (text, sent = []) => {
    messages.push({ role: "user", content: text });
    const r = await ask(url, delayMs, messages, sent);
    if (r.reply) messages.push({ role: "assistant", content: r.reply });
    transcript.push({ user: text, bot: r.reply, enquiry: r.enquiry });
    return r;
  };

  let r = await say("Hi, I am a builder. I need about 2,400 sq ft of 600 x 1200 mm glossy vitrified slabs delivered to my site in Model Town, Ludhiana within 10 days.");
  for (let turn = 0; turn < 6 && !r.enquiry; turn++) {
    if (!gaveDetails) {
      gaveDetails = true;
      r = await say("My name is Ravinder Sandhu, firm Sandhu Builders, WhatsApp +91 98765 43210.");
    } else if (CONFIRM_ASKED.test(r.reply) || gaveExtras) {
      askedToConfirm ||= CONFIRM_ASKED.test(r.reply);
      r = await say("Yes, that is all correct. Please send it to the team.");
    } else {
      gaveExtras = true;
      r = await say("Delivery to our site in Model Town, Ludhiana, needed within 10 days. Glossy finish in a light colour; the team can suggest designs. WhatsApp is best.");
    }
  }
  enquiry = r.enquiry;

  const problems = [];
  if (!askedToConfirm) problems.push("never clearly asked to confirm a summary");
  if (!enquiry) problems.push("no enquiry card after confirming");
  else {
    const d = enquiry.data || {};
    if (d.priority !== "high") problems.push(`priority is "${d.priority}", expected "high"`);
    if (d.country !== "India") problems.push(`country is "${d.country}", expected "India"`);
    if (!/^GT-/.test(enquiry.ref || "")) problems.push(`reference ${enquiry.ref} doesn't start with GT-`);
    if (!/98765\s*43210/.test(d.phone_whatsapp || "")) problems.push("WhatsApp number missing");
    if (!/sandhu/i.test(d.customer_name || "")) problems.push("name missing");
    const thanks = await say("thanks", [enquiry.ref]);
    if (thanks.enquiry) problems.push('"thanks" created a second enquiry');
  }
  const last = transcript.find((t) => t.enquiry) || transcript[transcript.length - 1];
  return {
    reply: last ? last.bot : "",
    pass: problems.length === 0,
    reason: problems.length ? problems.join("; ") : `summary and confirm, enquiry ${enquiry.ref} priority high, "thanks" made no second enquiry`,
    transcript,
  };
}

const cell = (s, n = 160) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return (t.length > n ? t.slice(0, n - 1) + "…" : t).replace(/\|/g, "\\|");
};

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const only = (flag("--only") || "").split(",").filter(Boolean).map(Number);
  const delayMs = Number(flag("--delay") ?? 20) * 1000;
  if (!args[0]) {
    console.error("Usage: node my-bot/tests/run-live-tests.mjs https://YOUR-BOT.workers.dev/chat [--only 1,2,15] [--delay 20]");
    process.exit(1);
  }
  const url = chatUrl(args[0]);
  const tests = readSheet(readFileSync(SHEET, "utf8")).filter((t) => !only.length || only.includes(t.number));
  console.log(`Testing ${url} with ${tests.length} test(s), ${delayMs / 1000} s between requests.\n`);

  const results = [];
  for (const t of tests) {
    let result;
    try {
      if (t.number === 15) result = await runTest15(url, delayMs);
      else {
        const r = await ask(url, delayMs, [{ role: "user", content: t.question }]);
        result = { reply: r.reply, ...judge(t.number, r.reply, r.enquiry) };
      }
    } catch (err) {
      result = { reply: "", pass: false, reason: `request failed: ${err.message}` };
    }
    results.push({ ...t, ...result });
    console.log(`${String(t.number).padStart(2)}  ${result.pass ? "PASS" : "FAIL"}  ${result.reason}`);
  }

  const score = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).map((r) => r.number);
  const lines = [
    "# Test results: Grewal Tile Gallery bot",
    "",
    `Bot: ${url}  `,
    `Run: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST  `,
    `Score: **${score} / ${results.length}**${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`,
    "",
    "PASS/FAIL comes from keyword checks in run-live-tests.mjs. Read every FAIL against the full reply below before changing the bot.",
    "",
    "| # | Question | Short reply | Result | Reason |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.number} | ${cell(r.question, 90)} | ${cell(r.reply)} | ${r.pass ? "PASS" : "FAIL"} | ${cell(r.reason, 140)} |`),
    "",
    "## Full replies",
    "",
  ];
  for (const r of results) {
    lines.push(`### ${r.number}. ${r.type}`, "", `A pass looks like: ${r.expect}`, "");
    if (r.transcript) {
      for (const t of r.transcript) {
        lines.push(`> **Customer:** ${t.user}`, ">", ...String(t.bot).split("\n").map((l) => `> ${l}`));
        if (t.enquiry) lines.push(">", `> *Enquiry card:* ${t.enquiry.ref}, priority ${t.enquiry.data?.priority}, ${t.enquiry.summary || ""}`);
        lines.push("");
      }
    } else {
      lines.push(`> **Customer:** ${r.question}`, ">", ...String(r.reply || "(no reply)").split("\n").map((l) => `> ${l}`), "");
    }
  }
  writeFileSync(RESULTS, lines.join("\n") + "\n");
  console.log(`\nScore: ${score} / ${results.length}${failed.length ? `. Failed: ${failed.join(", ")}` : ""}`);
  console.log(`Saved ${RESULTS}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
