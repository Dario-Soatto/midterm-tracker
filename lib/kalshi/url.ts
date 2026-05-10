import { KALSHI_URLS } from "./catalog";

/**
 * Build the public Kalshi web URL for a given event ticker.
 *
 * Kalshi's SPA requires the SEO slug ("california-governors-race") for the
 * page to render — the slugless form 404s. The slug isn't exposed by the
 * trade API, so we resolve URLs in this priority order:
 *
 *   1. Sitemap-resolved exact URL  (we cache these in KALSHI_URLS at catalog
 *      build time by parsing kalshi.com/sitemap-markets.xml).
 *   2. KXHOUSERACE-* shared pattern. Every per-district event under the
 *      KXHOUSERACE series renders at:
 *        kalshi.com/markets/kxhouserace/house-race-winner/<event-lower>
 *      regardless of whether the sitemap has indexed it yet, so we can build
 *      the URL deterministically for any of the 435 House districts.
 *   3. Last-resort search fallback so we at least land the user on Kalshi.
 */
export function kalshiEventUrl(eventTicker: string): string {
  const exact = KALSHI_URLS[eventTicker];
  if (exact) return exact;

  if (/^KXHOUSERACE-/.test(eventTicker)) {
    return `https://kalshi.com/markets/kxhouserace/house-race-winner/${eventTicker.toLowerCase()}`;
  }

  return `https://kalshi.com/?search=${encodeURIComponent(eventTicker)}`;
}
