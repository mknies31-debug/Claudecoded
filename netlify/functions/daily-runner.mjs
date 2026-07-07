// netlify/functions/daily-runner.mjs — ISOLATED SERVICE: the daily cron.
//
// Netlify Scheduled Function. Wakes once a day, loads the shared blob, runs the
// pure engine over it, and saves the result back so the browser pulls it on next
// load. It holds NO business logic of its own — that all lives in shared/engine.
//
// Schedule is declared via the exported `config` (Netlify reads it at deploy).
// 14:00 UTC ≈ 9:00am Central. Adjust the cron string to taste.
//
// Manual trigger for testing:
//   curl -X POST /.netlify/functions/daily-runner -H "x-cron-key: $CRON_SECRET"

import { runDailyCycle } from '../../shared/engine.mjs';
import { localDateStr } from '../../shared/sequences.mjs';
import { getEmailProvider } from './_lib/email-provider.mjs';
import { openStore } from './_lib/store.mjs';

export const config = { schedule: '0 14 * * *' };

export default async (req, context) => {
  // Scheduled invocations and manual POSTs both land here. Netlify's modern
  // runtime passes (Request, context); the Blobs lib wants the lambda-style
  // event for connectLambda, so hand it the context which carries it.
  const event = (context && context.clientContext) || context || {};
  const env = process.env;

  // ── Auth: the scheduled run is internal; any OTHER caller hitting the public
  // URL must present the secret. Netlify's scheduled invocation carries a
  // `next_run` in its JSON body — that's how we tell it apart from a web hit.
  let body = {};
  try { body = (req && req.clone) ? await req.clone().json() : {}; } catch { /* GET / empty body */ }
  const isScheduled = !!(body && body.next_run);
  if (!isScheduled) {
    const secret = env.CRON_SECRET;
    const provided = (req && req.headers && req.headers.get) ? req.headers.get('x-cron-key') : undefined;
    if (!secret || provided !== secret) {
      return json(401, { ok: false, error: 'unauthorized — manual triggers require the x-cron-key header to match CRON_SECRET' });
    }
  }

  try {
    const store = await openStore(event, env);
    if (!store.ready) {
      return json(200, { ok: false, skipped: true, reason: store.reason });
    }

    const provider = getEmailProvider(env);
    const { customers, touchLogs, report } = await runDailyCycle({
      customers: store.customers,
      touchLogs: store.touchLogs,
      today: localDateStr(), // Central-time calendar date, matches capture
      provider,
    });

    // Only write when the cycle actually changed something. A daily no-op write
    // of the whole snapshot is pure downside — it can clobber a phone edit made
    // while the job runs, for zero benefit.
    const changed = report.advanced || report.emailsSent || report.emailsFailed || report.textsQueued || report.tasksQueued || report.emailsHeld || report.logsPruned;
    if (changed) {
      const meta = { ...store.meta, lastRun: new Date().toISOString(), lastReport: report };
      await store.save({ customers, touchLogs, meta });
    }

    return json(200, { ok: true, provider: provider.name, wrote: !!changed, report });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
