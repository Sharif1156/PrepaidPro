# Architecture

PrepaidPro is deliberately small: one Node process, a folder of ES modules and
nothing else. This page explains the decisions behind that shape.

## Constraints that shaped the design

1. **The data sources are hostile.** DESCO's API is undocumented and exists in
   two generations; NESCO has no API at all and must be scraped from an HTML
   portal that requires a CSRF token and a session cookie. Both can change
   without warning, and both rate-limit.
2. **The audience uses mid-range Android phones on expensive data.** The UI must
   be a few hundred KB, work on a slow connection and keep working offline.
3. **Trust matters.** An app that asks for your meter number has to be
   inspectable. A zero-dependency, build-free codebase is one a user can read in
   an afternoon.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  index.html → app.js (router)                               │
│      ├── views/*.js        one module per screen            │
│      ├── lib/forecast.js   pure maths, unit-tested          │
│      ├── state.js          localStorage, single source      │
│      └── sw.js             offline shell + last snapshot    │
└───────────────────────┬─────────────────────────────────────┘
                        │ /api/meter/:provider/:account
┌───────────────────────▼─────────────────────────────────────┐
│ Node server (node:http only)                                │
│  server.js   routing · security headers · rate limit ·      │
│              gzip · ETag · static files · SPA fallback      │
│  cache.js    TTL + in-flight de-duplication                 │
│  desco.js    JSON client, two API generations               │
│  nesco.js    session replay + HTML parsers                  │
│  demo.js     deterministic generator                        │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS
        prepaid.desco.org.bd · customer.nesco.gov.bd
```

## Why forecast on the client?

- **Privacy.** 12 months of your usage never needs to leave the phone.
- **Latency.** Switching meters, changing a threshold or dragging the simulator
  is instant; no round trip.
- **Testability.** `lib/forecast.js` has no DOM and no `fetch`, so it is a plain
  module with 15 unit tests.

The trade-off is that the algorithm is public. That is a feature: the app shows
a "how this was calculated" panel, and anyone can check the arithmetic.

## The forecast model

```
perDay  = Σ(monthCost / daysInMonth × weight) / Σ(weight)
weight  = 0.62 ^ monthsAgo
```

- Recent months dominate, but a single unusual month cannot swing the estimate.
- The current month is divided by **elapsed** days, not the full month, so a
  quiet first week does not look like a sudden drop in consumption.
- If monthly readings are unavailable, the model falls back to average recharge
  spend over the recharge window.
- `daysLeft = balance / perDay`, and the confidence label comes from how many
  monthly readings exist (≥6 high, ≥3 medium, else low).

Deliberately absent: machine learning. With one reading per day and a dozen data
points per meter, a weighted average is both more accurate and explainable.

## Resilience

| Failure | Behaviour |
| --- | --- |
| Portal timeout | 12–15 s abort, `UPSTREAM_UNREACHABLE`, retry button |
| Portal HTML changed | Parsers return partial data; balance still shown with a warning |
| Two tabs, same meter | One upstream request (in-flight de-dupe) |
| Repeated refresh | Served from the 180 s cache unless `?refresh=1` |
| Offline | Service worker returns the cached API response and the app shell |
| Provider down | Last snapshot shown, labelled "Last known" |
| Bad input | Rejected before any network call |

## Security

- Strict CSP: `default-src 'self'`, no inline scripts, no third-party origins.
- All user-derived text goes through `textContent`, not `innerHTML`.
- The static server resolves and prefix-checks every path (no traversal).
- Only `GET` and `HEAD` are routed; API responses are `no-store`.
- Rate limiting is per-IP in memory — enough to protect the upstream portals,
  not a substitute for a real WAF.
- No secrets exist in the codebase: the app reads public portal endpoints that
  need no credentials.

## Adding a provider

1. Add a `src/<provider>.js` exporting `fetch<Provider>(accountNo)` that returns
   the normalised account shape.
2. Register it in `normalizeProvider()` in `server.js` and in `src/config.js`.
3. Add the parser fixtures to `test/`.
4. Add portal URL and copy in `public/js/views/*` and `i18n.js`.

The UI needs no changes: it reads `provider`, `balance`, `monthly`, `recharges`
and `customer` and nothing else.
