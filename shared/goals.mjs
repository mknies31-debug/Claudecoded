// shared/goals.mjs — CLEAN API: the Goals & Rewards engine (Mick's Level-Up layer).
//
// Isomorphic, dependency-free. The whole game is one rule: no reward until the
// box is checked. This module holds the data shape, the seed list (straight from
// Mick's "North Star Goals & Rewards" file), and the pure progress math. The CRM
// view (crm/goals rendering in crm.js) reads/writes through here; nothing about
// the DOM or a provider lives in this file.
//
// Storage: a single carvis_ key so it rides the existing CARVIS cloud sync +
// file backup automatically — no new backup/export system (CARVIS already has
// one). Distinct from `carvis_goals` (the monthly Sold/Deal number targets) on
// purpose: these are life/career objectives, not the dashboard gauges.

export const GOALS_KEY = 'carvis_referral_goals';

// Two lanes, each broken into the same groups Mick uses on paper. Order here is
// the order they render.
export const LANES = ['professional', 'personal'];
export const LANE_LABELS = { professional: 'Professional', personal: 'Personal' };

export const GROUPS = {
  professional: [
    'Now — Next 14 Days',
    'Next 90 Days',
    '6–12 Months',
  ],
  personal: [
    'Personal Goals',
  ],
};

// Reward ladder — plain reference copy, editable by Mick in the file too.
export const REWARD_LADDER = [
  { tier: 'Small win', when: 'a single task done', ideas: 'coffee run, favorite lunch, an hour of whatever you want' },
  { tier: 'Medium win', when: 'a streak or milestone hit', ideas: 'dinner out, new gear, half day off' },
  { tier: 'Big win', when: 'go-live, first video-traced sale, a 90-day streak', ideas: 'weekend trip, the big purchase you have been eyeing' },
];

// One uniform, fully-editable row shape covers every section:
//   objective  — what you're doing (the checkbox lives on this)
//   detail     — the "Target" or "Gate" column (e.g. "100%", "30 days straight",
//                "only after organic proves itself"); optional
//   deadline   — free text so "Ongoing" / a real date both work; optional
//   reward     — what you earn when it's checked; optional but the point
//   done/doneAt— the switch; a reward is "unlocked" only when done === true
export function newGoal(input = {}) {
  const clean = (s) => (input[s] == null ? '' : String(input[s])).trim();
  return {
    id: input.id || genId(),
    lane: LANES.includes(input.lane) ? input.lane : 'professional',
    group: typeof input.group === 'string' && input.group ? input.group : GROUPS.professional[0],
    objective: clean('objective'),
    detail: clean('detail'),
    deadline: clean('deadline'),
    reward: clean('reward'),
    done: input.done === true,
    doneAt: input.done === true ? (input.doneAt || null) : null,
  };
}

// Stable-ish id without Date.now (kept test-safe / resume-safe). The browser
// side passes its own id for user-added goals; the seed uses positional ids.
let _n = 0;
function genId() { _n += 1; return 'goal_' + _n.toString(36); }

// Toggle a goal's checkbox. Returns a NEW array (pure) so callers stay honest.
// `at` is the ISO timestamp to stamp (injected — no Date.now in shared).
export function toggleGoal(goals, id, at = null) {
  return (Array.isArray(goals) ? goals : []).map((g) => {
    if (g.id !== id) return g;
    const done = !g.done;
    return { ...g, done, doneAt: done ? (at || g.doneAt || null) : null };
  });
}

// Coerce any stored/loaded array into clean goal rows (migration-on-read).
export function sanitizeGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => newGoal({ ...g, done: g && g.done === true, doneAt: g && g.doneAt })).filter((g) => g.objective || g.reward || g.detail);
}

// Progress math — the motivational readout. Pure, no side effects.
//   total/done/pct          — overall
//   byGroup                 — { "lane::group": {lane, group, total, done} }
//   unlockedRewards         — checked goals that actually name a reward
//   nextUp                  — first few unchecked objectives (what to attack)
export function computeGoalStats(goals) {
  const list = Array.isArray(goals) ? goals : [];
  const total = list.length;
  const done = list.filter((g) => g.done).length;
  const byGroup = {};
  for (const lane of LANES) {
    for (const group of (GROUPS[lane] || [])) {
      byGroup[lane + '::' + group] = { lane, group, total: 0, done: 0 };
    }
  }
  for (const g of list) {
    const key = g.lane + '::' + g.group;
    if (!byGroup[key]) byGroup[key] = { lane: g.lane, group: g.group, total: 0, done: 0 };
    byGroup[key].total += 1;
    if (g.done) byGroup[key].done += 1;
  }
  const unlockedRewards = list.filter((g) => g.done && g.reward).map((g) => ({ objective: g.objective, reward: g.reward, doneAt: g.doneAt }));
  const nextUp = list.filter((g) => !g.done && g.objective).slice(0, 5);
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : 0,
    byGroup,
    unlockedRewards,
    nextUp,
  };
}

// The seed — Mick's working list, verbatim structure. Blanks in the file ("___")
// become empty fields with helpful placeholders in the UI, so he edits in place.
// Positional ids keep it stable across reloads until he changes something.
export function seedGoals() {
  _n = 0; // deterministic seed ids
  const P = (group, objective, detail, deadline, reward) => newGoal({ lane: 'professional', group, objective, detail, deadline, reward });
  const U = (objective, detail, deadline, reward) => newGoal({ lane: 'personal', group: 'Personal Goals', objective, detail, deadline, reward });
  return [
    // Now — Next 14 Days (the go-live sprint)
    P('Now — Next 14 Days', 'Add Gmail App Password to Netlify environment variables', '', '', 'Coffee + donut run, guilt-free'),
    P('Now — Next 14 Days', 'Drop the Google review link into the day-45 referral message', '', '', 'Your pick'),
    P('Now — Next 14 Days', 'Lock down the Lead Command Firebase database (no more world-readable)', '', '', 'Your pick'),
    P('Now — Next 14 Days', 'Complete GO-LIVE.md checklist — CRM officially live', '', '', 'Nice dinner out. This one is earned.'),
    // Next 90 Days (prove the engine)
    P('Next 90 Days', 'Daily walk-around streak, no misses (Sundays off)', 'days straight', '', ''),
    P('Next 90 Days', 'Buy-Side Ask / Car Guy alternating streak', 'days', '', ''),
    P('Next 90 Days', 'Every delivered customer enters the follow-up sequence (no exceptions)', '100%', '', ''),
    P('Next 90 Days', 'Close the loop on every referral (thank the sender, every time)', '100%', '', ''),
    P('Next 90 Days', 'First sale traced directly to a video', '1', '', 'Something bigger — half-day fishing? Your call.'),
    P('Next 90 Days', 'Best Customer Texts file — real texts pasted in, examples deleted', 'entries', '', ''),
    // 6–12 Months (the unlocks)
    P('6–12 Months', 'Unlock paid ad spend', 'Gate: only after organic content proves itself — sales/leads traced to videos', '', ''),
    P('6–12 Months', 'Build Agent #2 (follow-up sequencer, Cowork)', 'Gate: CRM live and stable first', '', ''),
    // Personal
    U('Sundays fully off — no CRM, no filming, no Marketplace', 'Every week', 'Ongoing', 'The Sunday itself'),
    U('Health — walk, gym, sleep, whatever is yours', '', '', ''),
    U('Family / time — dinner home by, a trip, an event', '', '', ''),
    U('Money — personal savings target, debt paid down', '', '', ''),
    U('Fun — the thing you keep putting off', '', '', ''),
  ];
}
