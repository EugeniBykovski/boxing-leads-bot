/**
 * Phrases sent to the Threads keyword search. Edit freely.
 *
 * Keep these BROAD: the provider only discovers candidates. Strict filtering
 * (boxing + request for coaching + Warsaw) happens locally in matcher.ts.
 *
 * Budget: Threads allows 2,200 keyword queries per user per rolling 24 h.
 * One scan uses at most one request per term (capped by MAX_REQUESTS_PER_SCAN),
 * so 20 terms × 48 scans/day = 960 queries/day.
 */
export const SEARCH_TERMS: readonly string[] = [
  // Polish
  'trenera boksu',
  'trener boksu',
  'treningi boksu',
  'boks Warszawa',
  'boks Warszawie',
  'klub bokserski',
  'zajęcia boks',
  // Russian
  'тренера по боксу',
  'тренер по боксу',
  'бокс Варшава',
  'бокс Варшаве',
  // Ukrainian
  'тренера з боксу',
  'тренер з боксу',
  'бокс Варшаві',
  // English
  'boxing coach',
  'boxing classes',
  'boxing Warsaw',
  'boxing gym Warsaw',
];
