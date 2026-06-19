// netlify/functions/daily-runner.mjs — ISOLATED SERVICE: the daily cron.
//
// Netlify Scheduled Function. Wakes once a day, loads the shared blob, runs the
// pure engine over it, and saves the result back so the browser pulls it on next
// load. It holds NO business logic of its own — that all lives in shared/engine.
//
// Schedule is declared via the exported `config` (Netlify reads it at deploy).
// 14:00 UTC ≈ 9:00am Central. Adjust the cron string to taste.
//
// Manual trigger for testing: POST /.netlify/functions/daily-runner

import { runDailyCycle } from '../../shared/engine.mjs';
import { getEmailProvider } from './_lib/email-provider.mjs';
import { openStore } from './_lib/store.mjs';

export const config = { schedule: '0 14 * * *' };

export default async (req, context) => {
  // Scheduled invocations and manual POSTs both land here. Netlify's modern
  // runtime passes (Request, context); the Blobs lib wants the lambda-style
  // event for connectLambda, so hand it the context which carries it.
  const event = (context && context.clientContext) || context || {};
  const env = process.env;

  try {
    const store = await openStore(event, env);
    if (!store.ready) {
      return json(200, { ok: false, skipped: true, reason: store.reason });
    }

    const provider = getEmailProvider(env);
    const { customers, touchLogs, report } = await runDailyCycle({
      customers: store.customers,
      touchLogs: store.touchLogs,
      today: new Date(),
      provider,
    });

    const meta = { ...store.meta, lastRun: new Date().toISOString(), lastReport: report };
    await store.save({ customers, touchLogs, meta });

    return json(200, { ok: true, provider: provider.name, report });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
