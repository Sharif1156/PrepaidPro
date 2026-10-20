# PrepaidPro — privacy policy

_This document describes exactly what this open-source build does. Host it at a
public URL if you run your own instance; replace the contact details with your
own._

## What the app stores on your device

| Data | Where | Why |
| --- | --- | --- |
| Meter/account numbers | `localStorage` | So the app knows which meters to check |
| Meter nicknames, per-meter alert thresholds | `localStorage` | Your labels and alert settings |
| Last known balance snapshot | `localStorage` | So the dashboard opens when you are offline |
| Language, theme, alert preferences | `localStorage` | Remembering your choices |

Nothing is sent to a PrepaidPro server except the meter number, and only to ask
the utility for that meter's balance.

## What the server keeps

- Meter readings are cached **in memory** for a few minutes (`CACHE_TTL_SECONDS`,
  default 180) to avoid hammering the utility portal. The cache is lost when the
  process restarts.
- Standard access logs (method, path, status, duration) are written to stdout by
  the hosting platform. They contain the meter number because it is part of the
  request path. If that matters to you, disable API logging or self-host.
- **No database. No accounts. No cookies. No analytics. No third-party
  scripts.**

## What is never collected

- No name, email, phone number or address.
- No location, contacts, photos or files.
- No advertising identifier, no tracking pixels, no fingerprinting.
- No card, mobile wallet PIN or bank credentials — the app is not a payment app
  and never accepts payment details.

## Who sees your data

- **DESCO / NESCO** — the meter number, to read its balance, exactly as their
  own portals do.
- **Your hosting provider** — the server operates on their infrastructure under
  their terms.

There is no one else. Data is never sold or shared for marketing.

## Retention

Delete a meter in the app and its snapshot is removed from your browser.
**Settings → Delete all data** clears everything this app has stored. The
server's in-memory cache expires on its own within minutes.

## Children

PrepaidPro is a household utility tool, not directed at children under 13.

## Contact

Open an issue at <https://github.com/Sharif1156/PrepaidPro/issues> or email the
maintainer listed in the repository profile.
