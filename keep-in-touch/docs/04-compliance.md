# Keep-In-Touch — Dealership Approval Summary (Compliance)

**Prepared for:** Owner / General Manager, Mosaic Autos, Zumbrota, MN
**Prepared by:** Mick Knies (salesperson) — Agent 4 (Compliance) drafted, Mick reviews
**Status:** Launch gate. Nothing goes live until the sign-off block at the bottom is filled in.
**Not legal advice.** Section (g) lists statutes for a lawyer to read. Nothing in this page guesses at what those statutes say.

---

## (a) What the system does

1. Mick enters a customer once, right after a sale: name, phone, email, vehicle, sale date, notes, and two separate consent checkboxes (email, text).
2. About every 90 days the app drafts one short, plain-text note in Mick's voice: a seasonal tip, a hello, or a referral ask. Every note ends with one easy question.
3. Emails send from "Mick at North Star Car Guy" through a transactional email service (Resend), with Reply-To set to a dedicated Gmail inbox Mick reads.
4. Texts are never sent by the app. It opens Mick's own Messages app pre-filled; Mick reads it and taps send from his own phone, or doesn't.
5. Day one, nothing sends until Mick taps Approve on Today's Queue. An optional later mode can auto-send the email version only, at 9:00 AM Central, and only to customers with recorded email consent.
6. One reply of STOP (or unsubscribe, opt out, remove me, and similar) on either channel, or one tap on the email unsubscribe link, marks the customer do-not-contact on both channels instantly and the app will not draft to them again.

## (b) Consent model

| | Email | Text (SMS) |
|---|---|---|
| Captured | At the sale, in the Add Customer form | At the sale, separate checkbox, same form |
| Stored fields | `emailConsent.given` (true/false), `emailConsent.at` (timestamp, auto-stamped when the box is ticked), `emailConsent.how` (required) | `smsConsent.given`, `smsConsent.at`, `smsConsent.how` (required) |
| "How obtained" choices | in person at sale · phone · text · email · web form | same |
| One consent does not imply the other | Yes — a customer can be email-yes and text-no, or the reverse | |

**Exact checkbox wording in the app** (from `compliance.js` → `consentLabels`, single source of truth):

- **Email (23 words):** *Okay for Mick (North Star Car Guy) to email me a few times a year with tips and a hello. I can stop anytime.*
- **Text (24 words):** *Okay for Mick to text me from his own phone now and then. Reply STOP to end texts. Message and data rates may apply.*

Mick reads the line to the customer in the driveway or at the desk, the customer says yes, Mick ticks the box, and the app stamps the time and requires him to pick how it was obtained. The consent summary shown on every customer's timeline reads, for example: `Email: yes (in person at sale, 2026-09-15) · SMS: no`.

### The one-time ask to past customers

Mick's decision (2026-09-15): the first message to everyone, including past
buyers he never asked, is a thank-you note that ends by asking whether it is
okay to keep sending seasonal notes. A customer with **no consent on file**
gets exactly that one note (slot ASK) and nothing else until a yes is
recorded. `COMPLIANCE.ASK_RULE` carries this paragraph in code.

- **By email: CAN-SPAM's opt-out model.** CAN-SPAM does not require prior
  consent for a commercial email; it requires an honest sender, a non-deceptive
  subject, a physical address, and a working opt-out honored promptly. The ask
  is sent to a person with a prior business relationship (they bought a vehicle
  from Mick), from Mick's real address, with the full footer (who, why, the
  Mosaic Autos address, the one-tap unsubscribe link) and the `List-Unsubscribe`
  headers, exactly like every other email. It is never auto-sent: the daily
  job has an explicit `slot !== 'ASK'` guard (tested) on top of its consent
  gate, so Mick or Ella taps Send Email on the card. `canAskByEmail` allows it
  only while the customer is active, has an email address, has no consent on
  either channel, and has never been asked.
- **By text: a hand-sent judgment call, flagged for the lawyer list.** The text
  version is a single message from Mick's own phone to a person who bought a
  vehicle from him, typed into Messages by the `sms:` link and sent by his
  thumb. It carries "Reply STOP to opt out." because it is the first text.
  TCPA treats texts more strictly than CAN-SPAM treats email, and the
  prior-relationship / personal-phone / no-autodialer facts are exactly the
  kind of thing section (g) asks a lawyer to confirm; until then, whether to
  send the text version at all is Mick's call, made one customer at a time.
  `canAskByText` has the same gate as email (phone present, no consent, never
  asked). The app never sends it.
- **What the app blocks after the ask.** `consentAskedAt` is stamped on the
  first channel used; from then on `nextTouch` returns nothing, the queue and
  the daily job skip the customer, `canAskByEmail`/`canAskByText` return false
  (no second ask, ever), and the timeline shows "Waiting on their answer" with
  two buttons. **They said yes** records consent on the channel(s) they said it
  for, with how ("email reply", "text reply", "phone", "in person at sale"),
  and the normal cadence starts 90 days later. **They said no**, a STOP, an
  unsubscribe tap, or an opt-out reply marks do-not-contact on both channels
  (reason "declined ask" / "STOP reply") and the goodbye rules above apply. An
  inbound email reply whose first line is a plain yes (and not an opt-out) is
  recorded as email consent by the webhook; anything ambiguous waits for Mick.
  "Not now" on the card hides the ask for 90 days without sending anything.
- **Consent summary wording** on the timeline and in the CSV: "Not asked yet",
  "Asked 2026-09-15 · waiting", and two new CSV columns, Consent Asked Date and
  Consent Ask Channel, so nothing about who was asked, when and how is only in
  Mick's memory.

## (c) Email — CAN-SPAM checklist (15 U.S.C. § 7701 et seq.; 16 CFR Part 316)

| Requirement | How this system meets it |
|---|---|
| Accurate From / Reply-To / routing | From: "Mick at North Star Car Guy <mick@northstarcarguy.com>". Reply-To: Mick's dedicated Gmail. Both set in Settings and in the send function's environment; never spoofed. |
| Non-deceptive subject line | Subjects are plain ("Deer season and your headlights"). The copy lint in `test/lint-templates.js` and the Auditor reject urgency, scarcity, dollar figures and superlatives. |
| Identify the sender honestly | Footer line: *"…from me, Mick Knies, North Star Car Guy, selling at Mosaic Autos…"* Nothing anywhere implies Mick owns Mosaic. North Star Car Guy is Mick's own brand (his decision 2026-09-15); Mosaic Autos is named as the physical location. |
| Identify the message as what it is | Footer says the reader is getting it because they bought a vehicle and said keeping in touch was okay, and that these are Mick's own pre-approved words sent on a schedule. |
| Physical postal address in every email | Last footer line: `North Star Car Guy at Mosaic Autos · {businessAddress}`. The address comes from Settings and is printed on every email without exception — if it is blank or still says [VERIFY], the line prints anyway so the gap is visible, and the deploy checklist blocks go-live until it is the real Mosaic Autos street address. |
| Working opt-out mechanism, clear and conspicuous | Footer line: *"Don't want these? One tap and you're off: https://…/?u=TOKEN"*. Public page, no login, no form, no "are you sure". One tap writes an opt-out record. |
| Honor opt-outs within 10 business days | Ours is instant on the next app open or scheduled run (whichever is first) and always before any send: the daily job processes opt-outs **before** it builds the send list. |
| No sending after opt-out | `canEmail()` returns false for any customer with status `dnc`; the queue, the Approve All button and the scheduled job all go through it. |
| No selling or transferring the opted-out address | The app has no export path except Mick's own CSV; opt-out status is a column in it so nothing gets re-imported as live. |
| Machine-readable unsubscribe (RFC 8058) | Every email carries headers `List-Unsubscribe: <unsubscribeUrl>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so Gmail/Yahoo/Apple show their own native "Unsubscribe" button and the one-click POST is honored the same way as the link. |
| Plain text, no tracking | Emails are plain text. No open pixels, no click tracking, no HTML. |

**The exact footer, as rendered** (four lines; the address is whatever Settings holds):

```
--
You're getting this because you bought a vehicle from me, Mick Knies, North Star Car Guy, selling at Mosaic Autos, and said it was okay for me to keep in touch. These are my own words, written and approved by me ahead of time and sent on a schedule.
Don't want these? One tap and you're off: https://<site>/?u=<token>
North Star Car Guy at Mosaic Autos · <business address from Settings>
```

## (d) Texts — TCPA (47 U.S.C. § 227; 47 CFR § 64.1200)

- **All texts are hand-sent by Mick from his own phone.** The app builds an `sms:` link that opens Messages with the draft filled in. No auto-dialer, no SMS API, no bulk send. The "auto-send texts" switch in Settings is hard-coded off and shown locked with this reason.
- **Prior express consent is still captured** (the SMS checkbox above, timestamped, with how it was obtained), even though a one-to-one text from a personal phone to someone with an existing business relationship is a very different risk profile from automated marketing texts. Lower risk is not zero risk; the checkbox costs nothing.
- **First text carries the opt-out notice.** The first text to any customer ends with *"Reply STOP to opt out."* (appended automatically while `firstTextSentAt` is empty). Later texts do not repeat it.
- **STOP in any casing, on either channel, flips the customer to do-not-contact for both channels instantly** and the app refuses to draft to them. Mick logs the STOP reply on the timeline (one tap: Mark do-not-contact, or paste the reply — the app detects it). The customer gets one two-sentence goodbye that leaves the door open, and then nothing.
- **CTIA keyword guidance.** The CTIA Messaging Principles and Best Practices treat STOP (and friends: END, CANCEL, UNSUBSCRIBE, QUIT) as universal opt-out keywords and HELP as the universal help keyword. Our detector honors all of them. If a customer texts HELP, Mick answers by hand — he is the help line.
- **Internal do-not-call list.** Opt-out records are kept (see (e)); the customer's status stays `dnc` so they can never be re-drafted by accident, which doubles as the internal DNC list the FCC rules expect a business to keep.
- **Quiet hours.** Mick sends texts by hand during normal business hours. Not enforced by software; enforced by the fact that a human is holding the phone. The lawyer may want a written internal rule (e.g., 9 AM to 8 PM local).

**Opt-out detection rule** (identical in `compliance.js` and the engine; unit-tested):
normalize to lowercase, trim, strip punctuation; opt-out if (a) the message contains "unsubscribe", "opt out" / "opt-out", "remove me", "do not contact", "don't contact", "stop texting", "stop emailing", or "take me off" anywhere; or (b) the first word is stop, quit, cancel, end or unsubscribe; or (c) the message is three words or fewer and contains stop, quit, cancel or end as a whole word.

*How the rule is tuned:* bare keywords ("STOP", "Stop.", "Quit", "END"), short filler phrases ("stop please", "stop it"), and clear phrases anywhere ("unsubscribe", "remove me", "do not text me", "end these emails") all count as opt-outs. Ordinary sentences that happen to use the word do not: "Stop by the lot Friday", "the stop sign", "I stopped by the lot", "Can you stop by Tuesday?" A false positive would silently lose a customer; a false negative means Mick reads the reply himself (every reply lands on the timeline) and taps do-not-contact. Known miss: "please opt *me* out" (the words are split). The engine and the compliance library share one byte-identical copy of this rule; the audit script checks they match.

## (e) Privacy

| Question | Answer |
|---|---|
| What is stored | Name, phone, email, vehicle (year/make/model/trim), sale date, optional birthday (month/day only), who referred them, a short notes field, the two consent records (given / when / how), every note sent, every reply logged, and opt-out records. |
| Where | Google Cloud Firestore, US region, encrypted at rest by Google. Firestore security rules deny all reads and writes except from Mick's own signed-in account. The single exception is the anonymous **create** of an opt-out record from the unsubscribe link, locked to exactly two fields (`at`, `source`) so nothing else can be written without a login. A copy is cached in the browser on Mick's phone (`localStorage`) so the app opens instantly and reads offline; that cache is on his device only, behind his phone lock. |
| Who can see it | Mick. Ella (Mick's assistant) only when Mick signs her in on a device he controls; anything she sends by hand identifies her as Ella. Nobody at the email provider reads content; Resend processes the outbound mail and (Tier 2) inbound replies as a data processor. |
| What is never stored | Social Security numbers, driver's license numbers, financing or lender details, credit information, dollar figures of any kind (price, trade value, payment). The notes field guidance says the same. |
| Retention | Kept until the customer opts out or Mick deletes them. **Opt-out records are retained deliberately** as a suppression list so an opted-out person is never re-added and re-messaged by accident; that is standard and expected under both CAN-SPAM and TCPA practice. |
| CRM of record | VinSolutions remains Mosaic Autos' CRM of record. This app is Mick's personal keep-in-touch tool. Its CSV export (First, Last, Phone, Email, Year, Make, Model, Trim, Sale Date, Referred By, Email Consent + date, SMS Consent + date, Status, Notes) is built so a record can be hand-entered into VinSolutions. |
| Deletion on request | Mick deletes the customer document; the timeline goes with it. Opt-out suppression entries survive by design (see Retention). |

## (f) Automated-contact honesty

- Scheduled emails (optional Tier 2 mode) are Mick's own words, written and approved by him ahead of time. The footer says so in plain English on every email. Nothing pretends to be a live, in-the-moment message when it is not.
- Anything Ella sends by hand signs "Ella, for Mick / North Star Car Guy / phone". She never sends as Mick.
- No fake deadlines, no false scarcity, no "I noticed you haven't replied", no exclamation points, no superlatives — enforced by the copy lint and the Auditor, not by good intentions.
- Every email signs off Mick / North Star Car Guy / phone number, with the Mosaic Autos address in the footer. Nothing implies Mick owns the dealership.

## (g) Minnesota-specific statutes — have a lawyer read; not legal advice

The list below is what a lawyer would want to look at before go-live. **I am not summarizing their contents.** Confidence notes say whether I am sure the citation exists as written, or whether the lawyer should confirm the section number.

| Citation | Why it matters here | Confidence in the citation |
|---|---|---|
| **Minn. Stat. § 325E.27** (in the § 325E.26–.31 range) | Minnesota's automatic dialing-announcing device (ADAD) statute — the lawyer should say whether hand-sent, one-to-one texts fall outside it (we believe they do, because nothing here is automated, but that is the lawyer's call). | Confident the ADAD provisions live in §§ 325E.26–.31. Have the lawyer confirm § .27 is the operative section. |
| **Minn. Stat. §§ 325E.311–.316** | Minnesota telephone solicitation / "no-call" provisions (Minnesota uses the national Do Not Call registry). Relevant to whether a text to a prior customer counts as a "telephone solicitation" and whether the existing-business-relationship exemption applies. | Confident these sections exist and cover telephone solicitation; lawyer should confirm the exact range and whether it reaches text messages. |
| **Minn. Stat. § 325F.694** | Minnesota's unsolicited commercial email statute. CAN-SPAM preempts most state email rules except those about falsity or deception, but the lawyer should confirm we are inside the safe zone (we send only to people who opted in, with a real address and a working opt-out). | Confident this section is Minnesota's commercial-email law. |
| **Minn. Stat. ch. 325M** | Internet privacy (aimed at internet service providers). Very likely not applicable to us; listed so the lawyer can rule it out in one line rather than have it come up later. | Confident the chapter exists; confident it is probably N/A. |
| **Minn. Stat. ch. 168A** | Certificates of title for motor vehicles. Only relevant if a template ever mentions title or registration timing. Today none do; the copy guide tells Mick not to add it. | Confident. |
| **Minn. Stat. §§ 325F.68–.70** (Prevention of Consumer Fraud Act) and **§§ 325D.43–.48** (Uniform Deceptive Trade Practices Act) | Any claim in any message is a consumer-facing representation. Our templates make no claims about price, value, availability or deadlines, but the lawyer should read the library once with these in mind. | Confident both exist. |
| **Minn. Stat. ch. 325O** — Minnesota Consumer Data Privacy Act (effective July 31, 2025) | State privacy law with consumer rights (access, delete, opt out of targeted advertising). Its applicability thresholds (number of consumers / revenue from data sales) very likely exempt a one-salesperson list of a few hundred customers, and it has a small-business exemption — but the lawyer should confirm, and should say whether Mosaic Autos as a whole is in scope in a way that pulls this data in. | Confident the chapter and effective date are right; lawyer confirms the thresholds and any 2026 amendments. |
| **Mosaic Autos' own advertising / communications policy** and any manufacturer co-op or franchise advertising rules | The dealership may already have rules on who may send customer communications under its name and what they must include. This page exists so the owner/GM can apply them. | N/A — internal. |
| **Federal: FTC Safeguards Rule, 16 CFR Part 314, and GLBA Privacy Rule (Reg P / 16 CFR Part 313)** | Car dealers that arrange financing are "financial institutions" under GLBA. The lawyer should say whether name/phone/email/vehicle of a sold customer is "customer information" of the dealer under Mosaic's information-security program, and if so, whether Mick's use of it in a personal tool needs to be listed in Mosaic's program (vendor/service-provider oversight, access controls). We store no financing data, which should help, but the classification question is the dealer's. | Confident the rules exist and that dealers are covered; the application to this data is the lawyer's call. |
| **Federal: FCC TCPA consent-revocation rule (47 CFR § 64.1200(a)(10)–(11), 2024 order, effective 2025)** | Codifies that a consumer may revoke consent by any reasonable means (including STOP, QUIT, END, CANCEL, UNSUBSCRIBE and plain-language requests) and that revocation must be honored promptly (within 10 business days). Our instant, any-channel flip is designed to exceed this. | Confident the order exists; lawyer confirms the citation and current effective provisions. |

**Questions for the lawyer, in one breath each:**
1. Does a hand-sent one-to-one text from a salesperson's personal phone to a prior customer with a ticked consent box fall outside the Minnesota ADAD and telephone-solicitation statutes?
2. Is our CAN-SPAM footer sufficient under § 325F.694, given the opt-in?
3. Is this customer list "customer information" under Mosaic's Safeguards program, and if so what paperwork does the dealership need from Mick?
4. Does ch. 325O apply to Mick, to Mosaic, or to neither at these volumes?
5. Should the dealership's postal address be the only address in the footer, or should Mick's contact line appear there too?

## (h) Sign-off

This system may go live for Mosaic Autos customers only after the lines below are complete.

| | |
|---|---|
| Reviewed by (Mosaic Autos owner / GM) | ______________________________ |
| Title | ______________________________ |
| Date | ____ / ____ / ________ |
| Business address to print in every email (exact) | ______________________________ |
| Lawyer consulted on section (g) (name / date, or "waived") | ______________________________ |
| Conditions or edits required before go-live | ______________________________ |
| Mick Knies acknowledgment | ______________________________  Date ____ / ____ / ________ |

## (i) Assumptions

1. The unsubscribe page is public and login-free by design (SPEC §2.4). Firestore rules permit exactly one anonymous action: creating an opt-out record with two fixed fields. This is the sole exception to "deny everything but Mick's login" and is called out in the rules file.
2. The footer contains a `?` in "Don't want these?" and in the unsubscribe URL (`/?u=`). The "exactly one question in the message" rule (SPEC §0) is applied to the body only; the sign-off and footer are outside it (SPEC §2.7). The Auditor counts `?` on the body, not on `emailFull`.
3. `canEmail` / `canText` require `status === "active"` literally. A customer document with a missing status is treated as not sendable. Safer to block than to guess.
4. `consentSummary` appends a third segment (` · Do not contact (reason, date)`) for `dnc` customers. Active customers match the SPEC string exactly.
5. The opt-out detection rule is the agreed shared rule with Agent 2 (engine). It does not catch "opt *me* out"; that is documented above rather than diverging from the engine. If a later version widens the rule, both files change together.
6. The physical address is always printed, even when blank or marked [VERIFY]; the deploy checklist is the gate that ensures a real Mosaic Autos street address is in Settings before the first send.
7. The SMS checkbox includes "Message and data rates may apply" per common CTIA-style practice, at 24 words. If Mosaic's counsel wants different wording, it lives in one place (`consentLabels` in `compliance.js`) and the Builder inlines it.
8. Statute citations in (g) were written from general knowledge, not from a live pull of the Minnesota Revisor site; the confidence column says which ones to double-check. None of their contents are summarized here.
9. Quiet-hours for hand-sent texts are a human practice, not software-enforced.
10. The `optOutReplyKind()` hint ("sms" / "email" / "") is advisory only; the app always flips both channels on any opt-out.
