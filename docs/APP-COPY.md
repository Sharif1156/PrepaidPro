# PrepaidPro — full product copy

Every user-facing string in the app, in one place. The English and Bengali
dictionaries live in [`public/js/i18n.js`](../public/js/i18n.js); this document
is the source-of-truth copy deck for the store listing, the site and the app.

---

## 1. Store listing copy

**Title**
PrepaidPro – DESCO & NESCO

**Short description (80 characters)**
Track your DESCO & NESCO prepaid meter balance, forecast days left, get alerts.

**Full description**

> PrepaidPro is the smartest way to manage your DESCO prepaid electricity
> meter. Never get caught off-guard by a sudden power cut again — know your
> balance before it runs out.
>
> ⚡ **KEY FEATURES**
>
> • **Real-time Balance Check** — See your exact DESCO prepaid meter balance
>   anytime, in seconds.
>
> • **Low Balance Alerts** — Get notified when your balance drops below your
>   chosen threshold.
>
> • **Recharge History** — View your full top-up history to understand your
>   spending pattern.
>
> • **AI-Powered Predictions** — The app learns your usage habits and predicts
>   when you'll next need a recharge.
>
> • **Multiple Meters** — Add and track more than one meter account from a
>   single app.
>
> • **Bengali & English** — Full support for both languages.
>
> • **Works Offline** — Your last known balance is always visible, even without
>   internet.
>
> 📊 **SMART USAGE INSIGHTS**
>
> PrepaidPro analyses your daily and monthly electricity consumption and gives
> you smart recharge suggestions — so you always recharge the right amount at
> the right time.
>
> 🔔 **STAY IN CONTROL**
>
> Set your own low-balance alert threshold. We'll notify you before your power
> cuts out — giving you time to recharge without any disruption.
>
> 🔒 **PRIVACY FIRST**
>
> PrepaidPro does not collect your name, email, phone number, or location. Only
> your meter number and notification preference are stored — and only to deliver
> your alerts. Your data is never sold or shared with advertisers.
>
> 📱 **WHO IS THIS APP FOR?**
>
> • DESCO prepaid electricity customers in Dhaka, Bangladesh
> • Households who want to avoid unexpected power outages
> • Businesses managing multiple prepaid meters
> • Anyone who wants to track and reduce their electricity consumption
>
> 🏠 **COMPATIBLE WITH ALL DESCO PREPAID METERS**
>
> PrepaidPro works with all residential and commercial DESCO prepaid smart
> meters across the Dhaka distribution zone — and with NESCO prepaid meters
> across the northern region.

**Category** House & Home · **Content rating** Everyone

---

## 2. In-app copy

### Onboarding

| Element | English | বাংলা |
| --- | --- | --- |
| Badge | Open source · No trackers | ওপেন সোর্স · কোনো ট্র্যাকার নেই |
| Headline | Never be surprised by **a dead meter** | **মিটার শেষ হয়ে যাওয়ার** আগেই জেনে যান |
| Lead | PrepaidPro reads your DESCO or NESCO prepaid meter and tells you how many days of electricity are left — before the lights go out. | PrepaidPro আপনার ডেসকো বা নেসকো প্রিপেইড মিটার পড়ে বলে দেয় আর কত দিন বিদ্যুৎ আছে — আলো নেভার আগেই। |
| Feature 1 | Live balance and a days-left forecast | লাইভ ব্যালেন্স ও দিন-বাকি পূর্বাভাস |
| Feature 2 | Usage trends and recharge history | ব্যবহারের ধারা ও রিচার্জ ইতিহাস |
| Feature 3 | Low-balance alerts at your own threshold | নিজের সীমায় কম-ব্যালেন্স সতর্কতা |
| Feature 4 | Bengali and English, works offline | বাংলা ও ইংরেজি, অফলাইনেও চলে |
| Primary button | Add your meter | মিটার যোগ করুন |
| Secondary button | Explore with demo data | ডেমো ডেটা দেখুন |
| Footnote | No sign-up. Your meter number never leaves this device except to query the utility. | রেজিস্ট্রেশন লাগবে না। ইউটিলিটি পোর্টালে কোয়েরি ছাড়া আপনার নম্বর ডিভাইস থেকে যায় না। |

### Dashboard

- **Remaining balance** — the meter's current credit, with the reading time and
  the alert threshold underneath.
- **Balance runway** — a 30-day bar that shows how much of a month's credit is
  left; labels read `0 / 15 days / 30 days`.
- **Days left** — the forecast countdown in the gauge.
- **Risk chip** — `Healthy` · `Watch` · `Low` · `Critical`.
- **Next-step banner**, e.g. _"Balance is getting thin. Plan a recharge this
  week."_
- **Stat tiles** — Spent this month (with a `+55.7% vs. same time last month`
  delta), Projected bill, Average per day, Last recharge.
- **Consumption trend** — six months of billed amounts.
- **What to do next** — recharge recommendation, notification setup, recharge
  rhythm.
- **Recent recharges** — top-ups with method, date and kWh.
- **Summary** — account, meter, tariff, division, reading time.

### Meters

- Empty state: _"No meters yet. Add your DESCO or NESCO prepaid meter number to
  see your balance, forecast and alerts."_
- Each card: balance, days left, last reading, threshold, and actions to make it
  active or remove it.
- Add dialog: utility, account/meter number, nickname, threshold, with the note
  _"Your meter number is stored only on this device."_

### Usage

- Month to date, projected month end, effective rate per kWh.
- Monthly consumption chart with Amount / Units and 6 / 12 month toggles.
- Estimated daily spend, recharge rhythm, and a month-by-month table.
- Footnote: _"Estimated from monthly readings — prepaid portals publish monthly
  totals only."_

### Insights

- Forecast card: gauge, burn rate, monthly run rate, expected run-out date,
  confidence, and a _"How this was calculated"_ panel.
- What-if simulator: daily spend and extra recharge sliders with a live
  days-of-credit readout.
- Recommendations: a concrete recharge amount, load-shifting, and watching the
  first week of the month.
- Recharge timeline.

### Settings

- Appearance (language, theme), Alerts (threshold, browser notifications), Your
  data (saved meters, export, delete), About (version, source, privacy,
  disclaimer).

### Alerts

| Trigger | Title | Body |
| --- | --- | --- |
| Balance below threshold | Low balance | `{meter} has {amount} left — about {days}.` |
| Balance below half the threshold | Balance almost empty | `{meter} has only {amount} left. Recharge now to avoid a disconnection.` |

### Error states

| Code | Title | Body |
| --- | --- | --- |
| Network / timeout | Could not reach the portal | The utility portal did not answer. This can happen when the portal is down, when the request is rate-limited, or when this app is running somewhere without access to Bangladeshi portals. |
| `ACCOUNT_NOT_FOUND` | Meter not found | The provider did not recognise that number. Double-check the account or meter number and try again. |
| `RATE_LIMITED` | Slow down a moment | Too many requests were sent in a short time. Wait about a minute and retry. |
| Offline | You are offline | Showing the last balance saved on this device. |

### Footer and legal

> PrepaidPro is an independent open-source project. It is not affiliated with,
> endorsed by, or operated by DESCO, NESCO or the Government of Bangladesh.
> Figures come from public utility portals and may lag behind your physical
> meter. Always confirm with your meter before making a payment decision.

---

## 3. Tone

- Plain, calm, specific. Say "6 days", not "insufficient runway".
- Never alarm without a reason: colour escalates only when the maths says so.
- Bengali copy is written, not machine-translated, and mirrors the English
  meaning rather than its word order.
- Numbers are always explicit about their source: _reading_, _estimate_ or
  _demo_.
