# 02 — How the app decides who gets what, and when

Written for Mick. This is the rule inside `netlify/functions/lib/engine.js`; the
tests in `test/engine.test.js` hold it to every number below.

## The rule in one breath

Thank-you note three days after the sale, then one note every 90 days from the
sale date. The note's *type* depends only on its number in the sequence, so the
mix works out to half useful tips, a quarter check-ins, a quarter referral asks.

| Touch | When | Type |
|---|---|---|
| 0 | sale + 3 days | THANKS (or THANKS_REPEAT for a repeat buyer) |
| 1 | sale + 90 | VALUE |
| 2 | sale + 180 | CHECK-IN |
| 3 | sale + 270 | VALUE |
| 4 | sale + 360 | REFERRAL (anniversary-flavored, see below) |
| 5 | sale + 450 | VALUE |
| 6 | sale + 540 | CHECK-IN |
| 7 | sale + 630 | VALUE |
| 8 | sale + 720 | REFERRAL (anniversary-flavored) |
| … | +90 each | pattern repeats every four touches |

## The 50 / 25 / 25 math

Every odd touch (1, 3, 5, 7 …) is VALUE. Every even touch alternates CHECK-IN,
REFERRAL, CHECK-IN, REFERRAL. In any block of four touches you get
VALUE, CHECK-IN, VALUE, REFERRAL: two of four are VALUE (50%), one is CHECK-IN
(25%), one is REFERRAL (25%). Because it is a block of four, the ratio is exact
at 4, 8, 12 … touches, not just "on average". A REFERRAL is always preceded by a
VALUE, so you never ask without having given first.

## Touch 4 = 360 days, not 365

Four 90-day steps is 360 days, so touch 4 lands five days *before* the one-year
mark, and every later anniversary touch drifts five more days earlier each
year. The copy says "coming up on a year" for that reason. Rule: any REFERRAL
touch whose date is within 30 days either side of a sale anniversary (year 1, 2,
3 …) uses the anniversary-flavored referral pool instead of the plain one. It is
date-based, so it keeps working after birthdays or replies have shifted the
ladder; it also means in some years the referral touch will fall outside the
window and just be a normal referral ask. Sold Feb 29 → anniversaries fall on
Feb 28 in non-leap years.

## Seasons

VALUE tips are picked from the pool for the season the note actually goes out
in (Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall). If a touch
sat in the queue from December to July, it gets a July tip, not an ice-scraper
tip. If a season's pool is empty the app falls back to the "any season" tips.

## Birthdays

If you entered a birthday and a touch lands within 14 days either side of it,
that touch becomes a BIRTHDAY note and the type it displaced moves to the next
touch (everything after it slides along by one). Touch 0 is never displaced.
Because the ladder drifts against the calendar, a birthday note happens only in
the years a touch happens to land near the birthday, roughly one year in three,
not every year.

## Replies reset the clock

When a customer replies to touch *n* (email, text, a logged phone call), the
next touch is due 90 days after the *reply*, and the ladder continues from
there. The touch numbers and types do not change, only the dates.

## Referrals

The moment you log a referral, two things happen: a REFERRAL_THANKS note shows
up in the queue as an extra item (it does not use up a touch number), and the
referrer's next REFERRAL slot is converted to a VALUE tip. You do not ask
twice in a row from someone who just delivered.

## Late touches and the 21-day gap (a deliberate deviation)

A missed touch is never dropped. It sits at the top of the queue, oldest first,
until you send it or press Skip. After you act, the next touch is scheduled from
the original sale-date ladder, not from the day you finally sent.

Here is the deviation, stated straight: taken literally that rule means a
customer 200 days overdue would get touch 1 today and touch 2 tomorrow (both
were past due). So the app keeps the original ladder **but never schedules the
next touch sooner than 21 days after an actual send** (`minGapDays` in
Settings). That floor applies to the very next touch only; the one after that is
back on the ladder unless it, too, is inside the gap. Skipping applies no floor,
because nothing was sent.

## Worked example: a Silverado sold 2026-09-15, birthday Dec 20

| Touch | Due | Type | Why |
|---|---|---|---|
| 0 | 2026-09-18 | THANKS | sale + 3 |
| 1 | 2026-12-14 | BIRTHDAY | 6 days before Dec 20; displaces VALUE |
| 2 | 2027-03-14 | VALUE | the displaced VALUE, carried forward |
| 3 | 2027-06-12 | CHECK-IN | carried ladder position 2 |
| 4 | 2027-09-10 | VALUE | carried ladder position 3 (the anniversary window is open, but this is not a referral slot, so no anniversary ask this year) |
| 5 | 2027-12-09 | BIRTHDAY | 11 days before Dec 20; displaces REFERRAL |
| 6 | 2028-03-08 | REFERRAL | the displaced REFERRAL, carried forward |
| 7 | 2028-06-06 | VALUE | carried ladder position 5 |

Touch 9 would land 2028-12-04, sixteen days from Dec 20, so that year gets no
birthday note and the ladder keeps its shape.

## Opt-out words

A reply is treated as an opt-out when it says unsubscribe, opt out, remove me,
take me off, do not contact / text / email, stop texting / emailing / sending,
no more texts / emails, or leave me alone anywhere in its first 80 characters;
when its first word is stop, quit, cancel, end or unsubscribe followed by
punctuation or the end of the message ("STOP", "Stop!!", "Stop, I don't want
these"); or when the whole message is three words or fewer built from one of
those words plus filler ("please stop", "stop it"). "Stop by the lot Friday",
"I stopped by", "the stop sign" and "End of the month works" are not opt-outs.
When in doubt the app leaves the customer active and you read the reply
yourself; a wrong opt-out silently loses a customer, a missed one just costs
you a glance.

## Assumptions (one line each)

1. Season for a VALUE tip is the season of the day the note goes out (today, or the due date if it is in the future), not the season it was originally due.
2. Anniversary flavor applies only when the *effective* slot is REFERRAL and the date is within ±30 days of a sale anniversary; a birthday carry can push the referral out of the window for that year.
3. Birthday notes occur only in years where a touch lands within ±14 days of the birthday; the app does not force one every year.
4. A skipped touch does not consume a referral credit; only a sent VALUE-instead-of-REFERRAL clears it.
5. A sent REFERRAL_THANKS counts as an actual send for the 21-day gap and for `firstTextSentAt`, but it never consumes a touch number.
6. `minGapDays` is taken from the event (`event.minGapDays`, default 21); the UI/daily job passes `settings.minGapDays`.
7. A reply logged when no touch has gone out yet anchors the ladder at the reply (touch 1 = reply + 90) but touch 0 stays at sale + 3.
8. A repeat purchase reactivates a do-not-contact customer per spec (`status: active`, `dnc: null`); consent must be re-captured on the Add screen — the engine does not touch consent fields.
9. Placeholders the engine cannot fill render as `[name]` and are listed in `render().missing`, so a blank hook or phone is visible before anything is sent.
10. Opt-out detection is stricter than "keyword anywhere in the first 80 characters" (SPEC §4) to avoid flipping a customer who wrote "stop by Friday"; the exact rule is in the engine comment and above.
11. `applyEvent` throws on an unknown event type rather than silently returning the customer unchanged.
