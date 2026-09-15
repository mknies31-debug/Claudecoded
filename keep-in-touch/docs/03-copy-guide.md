# Agent 3 — Copy Strategist: the template library and when to edit it

The library is `templates.json` (48 email/text pairs, one id per pair). Every
one passes `node test/lint-templates.js`: five sentences or fewer per email, two
or fewer per text, exactly one question and it is the last thing on the page,
no exclamation points, no dollar figures, no banned phrases, no superlatives,
nothing that sounds like Mick owns Mosaic Autos. (Mick's 2026-09-15 decision:
the brand on everything is North Star Car Guy, so that name is allowed.) The app adds the
sign-off (Mick / North Star Car Guy / phone) and the compliance footer; the bodies
never carry them.

## Counts and tone mix

| Pool | Pairs | Tones |
|---|---|---|
| THANKS (touch 0) | 4 | direct, softer, nepq |
| THANKS_REPEAT | 2 | direct, softer |
| VALUE fall / winter / spring / summer | 4 each | direct, softer, nepq in every season |
| VALUE any-season | 3 | direct, softer, nepq |
| CHECKIN | 6 | direct, softer, nepq |
| REFERRAL | 6 | direct, softer, nepq |
| ANNIVERSARY_REFERRAL | 3 | direct, softer, nepq |
| BIRTHDAY | 3 | direct, softer, nepq |
| REFERRAL_THANKS | 3 | direct, softer, nepq |
| GOODBYE | 2 | direct, softer (no question, by design) |

With 90-day spacing and least-recently-used picking, a customer does not see a
repeat inside any pool for well over 18 months.

## When you would edit one before sending (by slot)

**THANKS (sale + 3 days).** This is the one to spend a minute on. Add the one
detail from the sale day: the dog in the back seat, what they traded, the kid
who is going to drive it. If they mentioned a noise or a worry on the test
drive, name it. The consent question at the end stays as written.

**THANKS_REPEAT.** Name the first vehicle if you remember it. If a family
member drove the first one, say who is driving this one.

**VALUE.** Swap the highway for the road they actually drive home on (the hook
field is the place to look). If you know something specific about their
vehicle (new battery at the sale, a tow package), change the question to match.
Never add "swing by and I'll take a look" to the end. The value is the point.

**CHECKIN.** Fill the hook field before you send. "The roads out your way" is
the fallback, not the goal. The real version is "the Rochester run" or "the
gravel to Goodhue" or "the boat trailer".

**REFERRAL.** Swap "this spring" for the season it actually is, and "at work"
for wherever that person knows people (the plant, the school, the co-op, the
church). If they farm, "on your road" becomes "down the road". Never send a
REFERRAL to someone who just sent you one; the engine already converts that
slot to VALUE.

**ANNIVERSARY_REFERRAL.** These say "coming up on a year" because touch 4
lands at 360 days. Add the one thing you remember from the sale day so "I
still remember" is true on the page.

**BIRTHDAY.** If you know what they do for fun, ask about that instead of
"anything fun". Otherwise leave it alone.

**REFERRAL_THANKS.** Check the referred person's name is filled in. Do not add
a reward, a gift card, or a second ask.

**GOODBYE.** Do not add anything, even if they gave a reason. The whole point
is that it is short and asks for nothing.

## The principle behind each pool

- **THANKS: peak-end.** The last strong memory of the sale is this note, three
  days after, when the new-car feeling is still there. It is the highest-effort
  message in the system so the rest can be short.
- **VALUE: reciprocity, honestly earned.** Something a rural Minnesota driver
  can use today (deer at dusk on Hwy 52, a block heater cord check, salt on the
  undercarriage, the NHTSA recall lookup). No pitch attached, so the goodwill is
  real.
- **CHECKIN: consistency and identity.** Naming their vehicle and their road
  says "I remember you," which is the whole reason a person buys from the same
  guy twice.
- **REFERRAL: ask after giving, with a specific face.** Every REFERRAL follows a
  VALUE by design. "Anybody at work with a kid getting a license this spring?"
  lets a person picture one human instead of scanning their whole life.
- **BIRTHDAY / ANNIVERSARY: mere exposure.** A short, warm note that wants
  nothing keeps Mick a familiar name without wearing out the welcome.
- **REFERRAL_THANKS: gratitude without a hook.** Thanking someone and then
  asking again in the same breath undoes the thank-you.
- **Every message: low-friction reply.** One question, one-word answer. The
  goal is a reply on a busy day, not a paragraph.

## The Ella rule

Anything Ella sends by hand goes out with the sign-off "Ella, for Mick / North Star
Car Guy / phone". The body stays in Mick's voice; the sign-off is what makes it
honest. Scheduled sends are Mick's pre-approved words and the footer says so.

## Assumptions

- "Under 6 sentences" is read strictly as five or fewer; "under 3" as two or fewer.
- Highway numbers ("Hwy 52", "Hwy 58") are the only digits allowed in a body; the lint enforces it.
- `{hook|fallback}` fallbacks are written so a message still reads naturally if Mick never fills the field.
- The `{referred|…}` placeholder was added for REFERRAL_THANKS; the engine renders unknown placeholders as `[name]`, and the app flags them.
- Three template lint failures from the first draft (a subject with a bare "52", two over-long sentences) were fixed by the lead after the copy agent hit a session limit.
