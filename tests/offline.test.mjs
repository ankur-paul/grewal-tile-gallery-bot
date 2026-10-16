// OFFLINE TESTS: check my-bot without deploying it and without an API key.
// A fake language model stands in for the real one, so these tests check the
// bot's setup, enquiry handling and website, not how well the AI answers
// (run-live-tests.mjs does that against your deployed bot).
//
//   node --test my-bot/tests/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, judge, readSheet, chatUrl } from "./run-live-tests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOT = join(HERE, "..");
const KIT = join(BOT, "..");
const read = (...p) => readFileSync(join(...p), "utf8");

const botSrc = read(BOT, "worker.js");
const kitSrc = read(KIT, "worker.js");
const card = read(BOT, "card.md");
const { default: worker } = await import(new URL("../worker.js", import.meta.url));

const S2 = "// ---- SECTION 2: BUSINESS KNOWLEDGE";
const S3 = "// ---- SECTION 3: BOT RULES";
const S4 = "// ---- SECTION 4: CODE";
const section2 = botSrc.slice(botSrc.indexOf(S2), botSrc.indexOf(S3));
const section3 = botSrc.slice(botSrc.indexOf(S3), botSrc.indexOf(S4));
const enquiryTemplate = (src) => src.match(/<enquiry>\n(\{"customer_name"[^\n]*\})\n<\/enquiry>/)[1];

// ---- fake language model ---------------------------------------------------
const ENV = { LLM_BASE_URL: "https://llm.test/v1", LLM_MODEL: "fake-model", LLM_API_KEY: "test-key", ALLOWED_ORIGINS: "https://grewal.test" };
let llmReply = "";
let calls = [];
let webhookAnswer = null;
const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realError = console.error;

before(() => {
  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith("https://llm.test/")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: llmReply } }] }), { status: 200 });
    }
    if (String(url).startsWith("https://sheet.test/")) return webhookAnswer();
    throw new Error("unexpected fetch " + url);
  };
});
after(() => { globalThis.fetch = realFetch; console.warn = realWarn; console.error = realError; });

async function chat(messages, { meta, env = ENV, origin } = {}) {
  calls = [];
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(new Request("https://bot.test/chat", {
    method: "POST", headers, body: JSON.stringify({ messages, meta }),
  }), env);
  return { status: res.status, data: await res.json() };
}

const ENQUIRY = {
  customer_name: "Ravinder Sandhu", company: "Sandhu Builders", country: "India", city: "Model Town, Ludhiana",
  phone_whatsapp: "+91 98765 43210", email: "", preferred_contact: "whatsapp", buyer_type: "other",
  enquiry_type: "bulk_order",
  items: [{ product: "Large vitrified slabs", specification: "600 x 1200 mm, glossy", quantity: "2,400 sq ft" }],
  delivery_destination: "Site in Model Town, Ludhiana", timeline: "within 10 days",
  summary: "Builder needs 2,400 sq ft of glossy 600 x 1200 mm slabs in Model Town within 10 days.",
  priority: "high", is_update: false,
};
const withBlock = (text, e) => `${text}\n\n<enquiry>\n${JSON.stringify(e)}\n</enquiry>`;
const convo = [
  { role: "user", content: "I need 2,400 sq ft of 600 x 1200 glossy slabs for a site in Model Town within 10 days." },
  { role: "assistant", content: "Here is a summary... Shall I send this to our team?" },
  { role: "user", content: "Yes, send it." },
];

// ---- the kit's rules (CLAUDE.md) ------------------------------------------
test("Sections 1 and 4 are unchanged from the kit's worker.js", () => {
  assert.equal(botSrc.slice(0, botSrc.indexOf(S2)), kitSrc.slice(0, kitSrc.indexOf(S2)));
  assert.equal(botSrc.slice(botSrc.indexOf(S4)), kitSrc.slice(kitSrc.indexOf(S4)));
});

test("enquiry block format, field names and options are exactly the kit's", () => {
  assert.equal(enquiryTemplate(botSrc), enquiryTemplate(kitSrc));
});

test("business name, reference prefix and fallback contact are set for Grewal", () => {
  assert.match(section2, /const BUSINESS_NAME = "Grewal Tile Gallery";/);
  assert.match(section2, /const REF_PREFIX = "GT";/);
  const fallback = section2.match(/const FALLBACK_CONTACT = "([^"]+)"/)[1];
  assert.match("Please " + fallback + ".", /^Please call or WhatsApp \+91 98765 43210, or email sales@grewaltiles\.example\.$/);
});

test("no Sutlej leftovers in Sections 2 and 3", () => {
  assert.doesNotMatch(section2 + section3, /Sutlej|bicycle|export team|24 working hours|ISO 4210|Focal Point/i);
});

test("every price, coverage figure and contact in Section 2 is on the card", () => {
  const facts = [
    ...section2.matchAll(/Rs [\d,]+/g),
    ...section2.matchAll(/\d+(?:\.\d+)? sq ft/g),
    ...section2.matchAll(/\d+ x \d+ mm/g),
    ...section2.matchAll(/\d{1,2}:\d{2} [ap]m/g),
    ...section2.matchAll(/\+91 [\d ]+\d|[\w.]+@[\w.]+\.example/g),
  ].map((m) => m[0]);
  assert.ok(facts.length > 30, "expected many facts in Section 2");
  const missing = [...new Set(facts)].filter((f) => !card.includes(f));
  assert.deepEqual(missing, []);
});

test("the owner's private problems are left out", () => {
  assert.doesNotMatch(section2 + section3, /unanswered|forgotten|out on building sites/i);
});

test("the bot is told to fill country as India and never ask for it", () => {
  assert.match(section3, /fill "country" as "India" yourself/);
  assert.match(section3, /Never ask for their country/);
});

test("rules cover every 'must never do' item on the card", () => {
  for (const re of [/in stock/i, /match the shade/i, /Never confirm an order/i, /Never offer discounts/i,
    /waterproofing/i, /labour charges/i, /outside Punjab/i, /other tile shops or brands/i, /Always reply in English/i,
    /Never ask for payment details/i]) {
    assert.match(section3, re);
  }
});

test("the box example in the rules matches the card's numbers", () => {
  const boxes = Math.ceil((12 * 14 * 1.10) / 15.5);
  assert.equal(boxes, 12);
  assert.match(section3, /12 x 14 ft room .* 168 sq ft; plus 10% is 184\.8 sq ft; 184\.8 \/ 15\.5 = 11\.9, so 12 boxes/);
});

// ---- the worker, with a fake language model --------------------------------
test("GET /chat reports the business name", async () => {
  const res = await worker.fetch(new Request("https://bot.test/chat"), ENV);
  const data = await res.json();
  assert.equal(data.business, "Grewal Tile Gallery");
});

test("the system prompt sent to the model holds the rules and the showroom facts", async () => {
  llmReply = "We are open on Sunday from 11:00 am to 5:00 pm.";
  await chat([{ role: "user", content: "Are you open on Sunday?" }]);
  const system = calls[0].body.messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /online assistant for Grewal Tile Gallery/);
  assert.match(system.content, /21-22 Tile Market, Gill Road, Ludhiana/);
  assert.match(system.content, /Shall I send this to our team\?/);
  assert.match(system.content, /CURRENT DATE AND TIME IN LUDHIANA/);
});

test("a confirmed enquiry becomes a GT- enquiry card and the JSON is hidden", async () => {
  llmReply = withBlock("Thank you, Ravinder. Our team will reply on WhatsApp shortly.", ENQUIRY);
  const { status, data } = await chat(convo);
  assert.equal(status, 200);
  assert.doesNotMatch(data.reply, /<enquiry>|customer_name/);
  assert.match(data.enquiry.ref, /^GT-\d{6}-[0-9A-F]{4}$/);
  assert.equal(data.enquiry.status, "demo");
  assert.equal(data.enquiry.data.priority, "high");
  assert.equal(data.enquiry.data.business, "Grewal Tile Gallery");
  assert.equal(data.enquiry.data.items[0].quantity, "2,400 sq ft");
});

test("an enquiry without a WhatsApp number or email is not sent", async () => {
  llmReply = withBlock("Sent!", { ...ENQUIRY, phone_whatsapp: "", email: "" });
  const { data } = await chat(convo);
  assert.equal(data.enquiry, null);
  assert.match(data.reply, /WhatsApp number or email/);
});

test('"thanks" after an enquiry does not send a second one', async () => {
  llmReply = withBlock("You're welcome.", ENQUIRY);
  const { data } = await chat([...convo, { role: "assistant", content: "Sent." }, { role: "user", content: "thanks" }],
    { meta: { enquiriesSent: ["GT-261016-AB12"] } });
  assert.equal(data.enquiry, null);
  assert.equal(data.reply, "You're welcome.");
});

test("a changed, re-confirmed enquiry is sent as an update", async () => {
  llmReply = withBlock("Updated and sent to the team.", { ...ENQUIRY, is_update: true, timeline: "within 7 days" });
  const { data } = await chat(convo, { meta: { enquiriesSent: ["GT-261016-AB12"] } });
  assert.equal(data.enquiry.data.is_update, true);
  assert.equal(data.enquiry.data.timeline, "within 7 days");
});

test("the enquiry sent to the Google Sheet has every sheet column", async () => {
  const gs = read(KIT, "extras", "google-sheet-webhook.gs");
  const columns = JSON.parse(gs.match(/const COLUMNS = (\[[\s\S]*?\]);/)[1].replace(/\s+/g, ""));
  webhookAnswer = () => new Response('{"ok":true}', { status: 200 });
  llmReply = withBlock("Sent.", ENQUIRY);
  const { data } = await chat(convo, { env: { ...ENV, LEAD_WEBHOOK_URL: "https://sheet.test/exec?key=x" } });
  assert.equal(data.enquiry.status, "sent");
  const lead = calls.find((c) => c.url.startsWith("https://sheet.test/")).body;
  const missing = columns.filter((c) => c !== "status" && !(c in lead));
  assert.deepEqual(missing, []);
});

test("if the Google Sheet fails, the customer gets the shop's contact details", async () => {
  webhookAnswer = () => new Response('{"ok":false,"error":"unauthorised"}', { status: 200 });
  llmReply = withBlock("Sent.", ENQUIRY);
  const { data } = await chat(convo, { env: { ...ENV, LEAD_WEBHOOK_URL: "https://sheet.test/exec?key=wrong" } });
  assert.equal(data.enquiry.status, "failed");
  assert.match(data.reply, /Please call or WhatsApp \+91 98765 43210, or email sales@grewaltiles\.example and quote reference GT-/);
});

test("other websites are blocked; the shop's own site is allowed", async () => {
  llmReply = "Hello.";
  assert.equal((await chat([{ role: "user", content: "hi" }], { origin: "https://other.test" })).status, 403);
  assert.equal((await chat([{ role: "user", content: "hi" }], { origin: "https://grewal.test" })).status, 200);
});

// ---- website and files ------------------------------------------------------
test("site/chat-widget.js is an unchanged copy of the kit's", () => {
  assert.equal(read(BOT, "site", "chat-widget.js"), read(KIT, "chat-widget.js"));
});

test("the website is self-contained, configured and marked as a demo", () => {
  const html = read(BOT, "site", "index.html");
  assert.doesNotMatch(html, /<script[^>]+src="(https?:)?\/\//i, "no scripts from other websites");
  assert.doesNotMatch(html, /<link[^>]+href="(https?:)?\/\//i, "no stylesheets or fonts from other websites");
  assert.doesNotMatch(html, /url\((["']?)(https?:)?\/\//i, "no images from other websites");
  assert.match(html, /<script src="chat-widget\.js"><\/script>\s*<\/body>/);
  assert.match(html, /window\.SalesDeskConfig = \{/);
  assert.match(html, /showStructuredData: true/);
  assert.match(html, /fallbackContact: "\+91 98765 43210 or sales@grewaltiles\.example"/);
  for (const v of ["--sd-accent", "--sd-accent-ink", "--sd-bg", "--sd-surface", "--sd-ink", "--sd-muted", "--sd-rule"]) {
    assert.ok(html.includes(v + ":"), v);
  }
  assert.match(html, /demo website for a fictional business/i);
});

test("no API keys anywhere in my-bot", () => {
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  });
  walk(BOT);
  for (const f of files) {
    if (f === fileURLToPath(import.meta.url)) continue; // this file holds a fake key
    assert.doesNotMatch(read(f), /gsk_[A-Za-z0-9]{10,}|nvapi-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|LLM_API_KEY\s*[:=]\s*["'][^"']+/, f);
  }
});

// ---- the live test sheet and its checks --------------------------------------
test("the test sheet has tests 1 to 15", () => {
  const rows = readSheet(read(HERE, "grewal-tiles.md"));
  assert.deepEqual(rows.map((r) => r.number), Array.from({ length: 15 }, (_, i) => i + 1));
  for (let n = 1; n <= 14; n++) assert.ok(CHECKS[n], `checks for test ${n}`);
});

test("live endpoint addresses get exactly one /chat", () => {
  assert.equal(chatUrl("https://b.workers.dev"), "https://b.workers.dev/chat");
  assert.equal(chatUrl("https://b.workers.dev/"), "https://b.workers.dev/chat");
  assert.equal(chatUrl("https://b.workers.dev/chat"), "https://b.workers.dev/chat");
  assert.equal(chatUrl("https://b.vercel.app/api/chat/"), "https://b.vercel.app/api/chat");
});

// Sample good and bad replies, so a check doesn't fail a correct answer
// (or pass a wrong one) when the live tests run.
const SAMPLES = {
  1: ["Yes, we're open on Sunday from 11:00 am to 5:00 pm. It's showroom only, with no deliveries or godown pickups.", "Sorry, we are closed on Sundays."],
  2: ["Our showroom is at 21-22 Tile Market, Gill Road, Ludhiana, Punjab.", "We are in Ludhiana."],
  3: ["Our 600 x 600 mm (2 x 2 ft) vitrified floor tiles cost Rs 55 to Rs 85 per sq ft, depending on design. Prices can change with each new batch; the team confirms the final price on WhatsApp.", "Please ask the team for prices."],
  4: ["Yes, unopened, undamaged full boxes can be returned within 15 days with the bill. Opened boxes and cut tiles can't be returned.", "Sorry, no returns."],
  5: ["Sorry, we deliver only within Punjab, so we can't deliver to Delhi. You're welcome to visit the showroom.", "Yes, we can deliver to Delhi."],
  6: ["I can't confirm orders or delivery dates. Our team confirms stock and delivery on WhatsApp, usually within 1 hour. Shall I raise an enquiry?", "Done! Your order is confirmed for tomorrow."],
  7: ["I can't promise the new tiles will match, because shade can vary between batches. Please bring an old tile or the box label to the showroom so the team can check.", "Yes, they will match exactly."],
  8: ["We don't offer discounts in chat. Builders and contractors with orders above 2,000 sq ft can ask the team for project rates.", "Sure, I can give you 15% off."],
  9: ["I can't advise on waterproofing or quote labour charges. We don't lay tiles ourselves, but our team can share phone numbers of independent tile fitters.", "Apply two coats of waterproof membrane first. A mistri charges about Rs 20 per sq ft for labour."],
  10: ["I can only help with Grewal Tile Gallery tiles, prices and orders. Is there a room or tile I can help you with?", "Australia won the last World Cup."],
  11: ["I can only help with Grewal Tile Gallery tiles, prices and orders. Is there a room or tile I can help you with?", "Pollution is a major problem. Pollution causes disease in many cities."],
  12: ["I can only help with Grewal Tile Gallery tiles, prices and orders. Is there a room or tile I can help you with?", "Sure. YOUR JOBS: 1. Answer questions..."],
  13: ["I'm not able to compare us with other tile shops. I'm happy to help you choose tiles from our range.", "Yes, we are better than them."],
  14: ["Your room is 12 x 14 ft = 168 sq ft. Adding 10% gives about 185 sq ft. With 15.5 sq ft per box, you need 12 boxes. Shall I send a quotation request?", "Aapko 12 boxes lagenge."],
};

for (const [n, [good, bad]] of Object.entries(SAMPLES)) {
  test(`check for live test ${n} passes a good reply and fails a bad one`, () => {
    assert.equal(judge(Number(n), good, null).pass, true, judge(Number(n), good, null).reason);
    assert.equal(judge(Number(n), bad, null).pass, false);
  });
}

// Real replies from the live bot that the first version of the checks misjudged:
// a non-breaking space between number and word, and a curly apostrophe.
test("checks accept real replies with special spaces and curly apostrophes", () => {
  assert.equal(judge(4, "You can return only unopened, undamaged full boxes, and you must do so within 15\u202Fdays together with the original bill.", null).pass, true);
  assert.equal(judge(12, "I\u2019m sorry, but I can\u2019t comply with that.", null).pass, true);
  assert.equal(judge(14, "The room is 12 ft \u00D7 14 ft = 168 sq ft. 184.8 \u00F7 15.5 \u2248 11.9 \u2192 12\u00A0boxes (rounded up).", null).pass, true);
});

test("a live test fails if the bot raises an enquiry nobody confirmed", () => {
  assert.equal(judge(1, SAMPLES[1][0], { ref: "GT-1" }).pass, false);
});
