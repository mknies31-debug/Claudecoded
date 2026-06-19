// scripts/dry-run.mjs — preview the daily cycle against sample data.
//
// Run: `npm run crm:dry`
// Sends nothing, writes nothing. Shows exactly what the cron would do today.

import { runDailyCycle } from '../shared/engine.mjs';
import { newCustomer } from '../shared/schema.mjs';

function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }

const sample = [
  newCustomer({ firstName: 'Dale', vehicle: '2019 F-150', email: 'dale@example.com', phone: '5075550101', purchaseDate: daysAgo(2) }),
  newCustomer({ firstName: 'Brenda', vehicle: 'RAV4', email: 'brenda@example.com', purchaseDate: daysAgo(14), stage: 1 }),
  newCustomer({ firstName: 'Stagnant Sam', vehicle: 'Equinox', email: 'sam@example.com', purchaseDate: daysAgo(60), stage: 2 }),
  newCustomer({ firstName: 'OptedOut Olive', vehicle: 'Camry', email: 'olive@example.com', purchaseDate: daysAgo(45), optedOut: true }),
];

const { report } = await runDailyCycle({ customers: sample, touchLogs: [], today: new Date(), approved: false, dryRun: true });

console.log('North Star Referral CRM — dry run for', report.date);
console.log(JSON.stringify(report, null, 2));
console.log('\nNote: templatesApproved is false, so real runs HOLD emails until copy is approved.');
