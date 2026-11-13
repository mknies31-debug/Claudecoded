# Case Lab

A playtest engine for printed party games (escape, mystery, hunt, party). It's built from
`case-lab-code-outline-2` (the "how" companion to `case-lab-playtest-engine-spec.md`).
The app is plain HTML/CSS/JS, uses Firebase Auth + Firestore, and runs on Netlify with two
Netlify Functions. There's no framework and no build step.

```
case-lab/
├── index.html              # whole app: CONFIG → STATE → DB → SCHEMA → LOGIC → AI → LIVE → REPORT → UI
├── netlify.toml            # deploy as its own site, Base directory = case-lab
├── package.json            # firebase-admin for the proxies; `npm test`
├── netlify/functions/      # claude.js, gemini.js (both verify the Firebase login)
├── netlify/lib/auth.js     # shared login check
├── samples/                # snowed-in-broken.json (logic test), supper-club-ambiguous.json (AI test)
├── tests/logic.test.mjs    # runs the real SCHEMA→REPORT code out of index.html
└── firestore.rules
```

## Try it now (demo mode)

While `CONFIG.firebase.apiKey` in `index.html` still starts with `YOUR_`, the app runs in
**demo mode**. Data stays in that browser's localStorage, and live AI calls are off.
To run an AI tester by hand, click **Copy prompt**, paste it into any chat, then paste the
JSON reply back under **Paste a result by hand**. Serve the folder with any static server
and open `index.html`:

```bash
cd case-lab && python3 -m http.server 8000
```

## Go live

1. **Firebase:** create a project, then turn on Google sign-in and Firestore. Paste the web
   config into `CONFIG.firebase`. Sign in once, copy your uid from Authentication → Users,
   put it in `firestore.rules`, and publish those rules.
2. **Netlify:** create a new site from this repo with **Base directory = `case-lab`**, then set:

   | Variable | What it's for |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | Claude proxy |
   | `CLAUDE_MODEL` *(optional)* | defaults to `claude-sonnet-5-5` |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini proxy. Look up the current model name in Google's docs |
   | `ALLOWED_UID` | your Firebase uid. Every other caller gets a 403 |
   | `FIREBASE_SERVICE_ACCOUNT` | service-account JSON, pasted whole (or set `FIREBASE_PROJECT_ID`) |

3. Add the Netlify domain to Firebase → Authentication → Authorized domains.

## Case bible fields this build relies on

These fields go beyond the outline's required list:

- **items:** `kind` (`card|envelope|photo|phone|prop`), `start`, `level` (an array of levels;
  leave it out for all levels), `pages` (default 1), `color` (bool), `playerText`,
  `phone: {qr, fallback}`, and `tags: [{suspect, type: means|motive|opportunity|alibi}]`.
  Mark a red herring with `{type: "redHerring"}`.
- **puzzles:** `needs` can list items or puzzles. `unlocks` lists items.
- **final:** `text`. **legend:** `{needs, text, answer}` (optional hidden bonus).
- **mysteries:** `suspects` and `solution.culprit`.

## Choices I made where the outline was open

- **Launch gate (6 items):** zero critical logic issues · the final can be reached at all 3 levels ·
  a blind AI solver got the final right at every level · no possible second answers and no
  confirmed critical hunter issues · 3+ detective live tests with a 70%+ solve rate ·
  average fun 4+ and at least half would pay. Edit `launchGate()` if Part 1 of the spec says
  something different.
- **Unreachable items:** critical if something needs the item, warning if it's an orphan
  (like `c7`). An issue that shows up at every level is shown once, marked `all`.
- **Live test order:** follows the chosen level's solve steps. The outline said detective steps,
  and detective is still the default level.
- **A live test counts as solved** when nobody gave up and, for a mystery, the group named the
  right culprit.
- **The blind-solver JSON has a `finalAnswer` field** so escape and hunt cases can be scored too.
  `accusation` still covers mysteries.
- **The Claude proxy sends `fallbacks: "default"`.** If a safety classifier declines a request,
  it gets re-run on a fallback model. It also sends an `effort` setting (`low` for blind runs,
  `medium` for the hunter) to keep replies fast.

## Known limit: function timeout

These are synchronous Netlify Functions. A hunter run on a big bible can take longer than
Netlify's sync time limit. If runs come back as 502/504, move the AI call into a background
function that writes its result to Firestore, and have the page listen for it.

## Tests

```bash
cd case-lab && npm test
```

The test suite covers the build-order checks. The snowed-in sample must show the unreachable
`c7`, the duplicate `1225`, and `s3` as a second killer. In the supper-club sample, a solver that
answers HAM but also lists BUG must be flagged `possible_second_answer`. Other tests cover hunter
merge confirmation, live stats, scores, the launch gate, the fix prompt and version compare.
