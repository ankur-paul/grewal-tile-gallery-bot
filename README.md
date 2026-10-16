# Grewal Tile Gallery chatbot

A website chatbot for a fictional tiles showroom in Ludhiana, built from the Session 10 starter kit.

| File | What it is |
|---|---|
| `card.md` | The business card. Every fact the bot and website use comes from here. |
| `worker.js` | The bot. Only Section 2 (business knowledge) and Section 3 (bot rules) differ from the kit's `worker.js`. |
| `site/index.html` | One-page website with a box calculator and the chat widget. |
| `site/chat-widget.js` | Unchanged copy of the kit's chat widget. |
| `tests/grewal-tiles.md` | The 15 tests, in the same format as the kit's `tests/` sheets. |
| `tests/run-live-tests.mjs` | Sends the 15 tests to your deployed bot and writes `test-results.md`. |
| `tests/offline.test.mjs` | Checks the bot, website and test checks with a fake AI. No key or deployment needed. |

## Deploy

Same as the kit: paste `worker.js` into a Cloudflare Worker (or use Prompt 6 or 7), then set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` (secret) and `ALLOWED_ORIGINS` in the platform's settings. Never put the key in a file. Then set `endpoint` in `site/index.html` to your worker's address plus `/chat`.

## Run the tests

Needs Node.js 18 or newer. Run from the starter kit folder.

```
node --test my-bot/tests/offline.test.mjs
```

After the bot is deployed:

```
node my-bot/tests/run-live-tests.mjs https://YOUR-BOT.workers.dev/chat
node my-bot/tests/run-live-tests.mjs https://YOUR-BOT.workers.dev/chat --only 6,14,15
```

The live run takes about 6 minutes (20 seconds between requests; with 5 seconds the free AI plan refused most requests). PASS/FAIL comes from keyword checks, so read every FAIL against the full reply at the bottom of `test-results.md`, and also try tests 6, 12 and 15 by hand on the website.
