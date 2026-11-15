# Security

## Reporting a problem

Please report security issues privately, not in a public issue. Use GitHub's private
vulnerability reporting: the repository's **Security** tab, then **Report a vulnerability**
(https://github.com/Swapnil007-Curious/agentic-rag/security/advisories/new). Include what you
found, how to reproduce it and what it affects. This is an independent student project
maintained by one person, so replies may take a few days. There is no bug bounty.

Useful reports include:

* a way to read or misuse the model API key held by the Worker (`deploy/worker/`);
* a way around the Worker's rate limits, its origin check or its input validation;
* script injection through answers, passages, uploaded PDFs or share links (`?q=`) in the web
  app (`web-static/`) or the local Python app;
* a secret committed to this repository.

## The hosted demo

* **Rate-limited.** The Worker allows 20 requests per 10 minutes and 200 per day per visitor
  (by `CF-Connecting-IP`), and 800 requests per day across all visitors. Messages are capped at
  4000 characters and 10 turns, and replies at 1500 tokens.
* **No user data is stored.** Neither the site nor the Worker stores or logs questions, answers
  or conversations. The Worker keeps only request times per client address, for at most a day,
  to enforce its limits. Conversations, settings and game progress stay in the visitor's browser
  (localStorage). Attached PDFs are read and embedded in the browser and never uploaded.
* **What leaves the browser.** To produce an answer, the question, the recent conversation (or
  its summary) and the passages selected for it go through the Worker to the model provider
  (Groq). The provider's own terms apply to that request. In Chrome, dictated speech goes to the
  browser's speech service; the app says so before the first use.
* **Secrets.** The model API key exists only as a Cloudflare Worker secret (`LLM_API_KEY`). It is
  never in the repository, the site or a response. Local development reads it from
  `deploy/worker/.dev.vars`, which git ignores.

## Supported version

Only the latest release (v1.0.0) and the live demo are maintained.
