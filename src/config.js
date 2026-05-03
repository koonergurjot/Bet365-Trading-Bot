/**
 * API configuration for local/personal use only.
 * Any shared or deployed instance should proxy these calls server-side.
 */

export const API_CONFIG = {
  /**
   * The Odds API
   * Current app assumption: free-tier style 500-credit monthly budget.
   *
   * Verified docs details:
   * - /sports does not consume quota.
   * - /odds costs regions x markets per sport request.
   *
   * With the defaults below:
   * - regions = eu,us -> 2
   * - markets = h2h,spreads,totals -> 3
   * - cost per sport request = 6 credits
   * - 6 sports in one cycle = 36 credits
   */
  theOddsApi: {
    key: "93adaeaeb4b4485076ed6cf80554c452",
    baseUrl: "https://api.the-odds-api.com/v4",
    regions: "eu,us",
    markets: "h2h,spreads,totals",
  },

  /**
   * OddsBlaze
   * Public docs require an API key, but public trial/free rate limits are not
   * clearly published in the docs we could verify. This app therefore uses a
   * conservative 2.1s spacing between requests to avoid burst traffic.
   */
  oddsBlaze: {
    key: "1525d4bf-8eb5-4690-a552-1a4bd8c28b4a",
    baseUrl: "https://odds.oddsblaze.com",
    leagues: ["nba", "mlb", "nhl"],
    sportsbooks: ["bet365", "draftkings", "pinnacle"],
    sleepMsBetweenCalls: 2100,
  },

  /**
   * TheSportsDB
   * Verified docs details:
   * - free key is 123
   * - free tier rate limit is 30 requests/minute
   *
   * We stay under that with a 2.1s delay and session cache.
   */
  sportsDb: {
    key: "123",
    baseUrl: "https://www.thesportsdb.com/api/v1/json/123",
    sleepMsBetweenCalls: 2100,
  },
};

export const QUOTA = {
  monthlyLimit: 500,
  warnThreshold: 80,
  stopThreshold: 15,
  costForSportsList: 0,
};

/**
 * Free-tier-safe polling defaults for the current Odds API settings.
 *
 * Cost math with defaults:
 * - 3 sports x 2 regions x 3 markets = 18 credits per cycle
 * - 500 / 18 ~= 27 full cycles per month
 *
 * Safe automatic cadence:
 * - every 72h ~= 10 cycles/month ~= 360 credits
 *
 * This leaves room for manual refreshes and avoids exhausting the plan.
 */
export const POLL_CONFIG = {
  defaultIntervalMs: 72 * 60 * 60 * 1000,
  minIntervalMs: 72 * 60 * 60 * 1000,
  maxSports: 3,
};

export const PRIORITY_SPORTS = [
  "basketball_nba",
  "baseball_mlb",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_uefa_champs_league",
  "icehockey_nhl",
  "americanfootball_nfl",
  "basketball_ncaab",
  "tennis_atp_french_open",
  "tennis_wta_french_open",
  "mma_mixed_martial_arts",
  "boxing_boxing",
];
