# North Star CRM — Health & Monitoring

A light, repeatable cadence so "live" stays healthy. Split into **what's
automated** (runs against the code, anytime) and **what needs the live deploy**
(real keys + real sends — can't be faked locally).

---

## A. Automated health scan (run anytime, ~5 seconds)
```bash
npm test          # 45 checks: engine, compliance, sequencing, intake, import, hydrate
npm run crm:dry   # runs the daily cron over sample data, prints the report, sends nothing
```
This proves the **logic** is sound end-to-end: customers advance through the
timeline, emails hold/send/retry correctly, texts and tasks queue, the 90-day
rotation fires, import dedupes, and copy passes the compliance rules. Run it
before every deploy.

What the suite already guarantees so you don't have to spot-check by hand:
- **No duplicate contacts** — bulk import dedupes by phone, and manual add now
  blocks a repeat phone number.
- **Sane timestamps/stages** — imported past customers slot into the right stage
  by purchase date instead of getting the welcome series.
- **Instant feedback** — every save / send / complete / mark-done shows a toast.

## B. Live checks (do these once, right after deploy — they need real keys)
These are the checklist items that can't run locally:

- [ ] **Walk the core flow with a real test customer:** add customer → it lands
      in the pipeline → fire a queued text → trigger/lower a purchase date to make
      an email due → run the cron by hand → see it in "Emails Cleared Today" →
      mark a referrer thanked. (Use your own phone/email as the test customer.)
- [ ] **Error logs, first 24–72h:** Netlify → **Functions → daily-runner / carvis
      / send-email → logs.** Watch for repeating 4xx/5xx. A one-off is noise; a
      pattern is a bug.
- [ ] **Spot-check 30–50 records** after your first import: no dupes, names/phones
      look right, purchase dates and stages make sense.
- [ ] **Email deliverability** — see below.

## C. Email deliverability (Gmail path)
You send **from your real Gmail via Gmail's SMTP**, so authentication is mostly
handled for you:
- **SPF / DKIM / DMARC** for `gmail.com` are published and signed by **Google** —
  mail sent through `smtp.gmail.com` passes them automatically. You don't manage
  DNS for this path.
- **Bounces & complaints** come back to your **normal Gmail inbox** — watch for
  "Delivery Status Notification (Failure)" and clean those numbers from the CRM.
- **Spam placement:** send your first few to your own other addresses (Outlook/
  Yahoo) and confirm they land in the inbox, not spam. Keep volume low and human;
  the copy is plain-text-style and personal, which helps.
- **Limit:** free Gmail ≈ 500 recipients/day — far above your volume.
- _If you later move to the `northstarcarguy.com` domain (Resend path), THEN you'd
  add SPF, DKIM, and DMARC DNS records and verify the domain in Resend._

---

## D. Ongoing cadence
**Daily (1 min):** glance at Netlify function logs for errors and at Gmail for
bounce/failure notices.

**Weekly (10 min):**
- Referral volume + response: how many referral asks went out, how many replies.
- Where people drop off in the referral/email flow.
- A quick "UI friction" pass with you/Ella — what confused anyone, what felt slow,
  what got ignored.

**Always:** keep a backlog of the **top 3** next improvements (stability →
clarity → response rate). Add to it, don't let it grow past 3 active.

## E. The weekly self-check (run it in your head with Ella)
1. **Where did anything crash, lag, or silently fail this week?**
2. **Where did we feel lost on what to click next?**
3. **Where did customers hesitate or not respond in the referral/email flows?**

If you can name the exact **screen and button**, that's where the next tune-up
goes — tell me and I'll fix it.

---

### Current backlog (top 3)
1. _(open)_ Your **Gmail App Password** + **Google review link** — the last two
   inputs before email + the review ask are fully live.
2. _(open)_ Real-device pass: voice intake voice quality (pick the best voice in
   the dropdown), one-tap text, photo/PDF capture.
3. _(open)_ After a week of real use: tune whichever screen the self-check flags.
