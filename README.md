# Memory Trainer

A private, offline flashcard app with spaced repetition — your own Quizlet replacement.
No accounts, no subscriptions, no ads, no cloud, no analytics. Plain HTML/CSS/JavaScript, no build step, no dependencies.

---

## Folder structure

```
memory-trainer/
├── index.html              App shell, iOS meta tags, strict Content-Security-Policy
├── manifest.json           PWA manifest (name, icons, standalone display, shortcuts)
├── service-worker.js       Offline cache (precache + cache-first), update flow, notification clicks
├── README.md               This file
├── css/
│   └── styles.css          Mobile-first styles, light/dark themes, large tap targets
├── icons/
│   ├── icon-192.png        Android/desktop icon
│   ├── icon-512.png        Splash / large icon
│   ├── icon-maskable-512.png  Adaptive (maskable) icon
│   ├── apple-touch-icon.png   iPhone Home Screen icon (180×180)
│   └── favicon-32.png
└── js/
    ├── theme-boot.js       Sets light/dark before first paint (no flash)
    ├── app.js              Router + views: home, decks, cards, quick add, search, tags, settings
    ├── study.js            Study mode (flashcards) and Quiz mode (multiple choice) + session report
    ├── stats.js            Statistics dashboard and study-streak calculation
    ├── srs.js              Spaced-repetition scheduler
    ├── db.js               IndexedDB storage layer, data model, import/merge/export
    ├── charts.js           Dependency-free canvas bar charts
    ├── markdown.js         Small, safe Markdown renderer for notes
    ├── ui.js               Shared helpers (dialogs, toasts, file save/open)
    └── sample-deck.js      Starter deck loaded on first run
```

---

## Run it locally (optional)

Service workers need `http://localhost` or `https://`, so opening the file directly (`file://`) works for a quick look but won't go offline. From the folder:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

---

## Deploy (free) — pick one

### GitHub Pages
1. Create a new repository on github.com (e.g. `memory-trainer`). Public is required on the free plan.
2. Upload the **contents** of this folder (so `index.html` is at the repo root): *Add file → Upload files*, drag everything in, *Commit*.
3. Go to *Settings → Pages*. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main` / `(root)`**, *Save*.
4. Wait a minute. Your app is at `https://<your-username>.github.io/memory-trainer/`.

All paths are relative, so the sub-path works without changes. **Your card data is never uploaded** — the repo only holds the app's code. Your cards live on your phone.

### Cloudflare Pages
**Option A — drag and drop (no Git):**
1. Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Upload assets*.
2. Name the project (e.g. `memory-trainer`), drag in this folder (or the zip), *Deploy*.
3. Your app is at `https://memory-trainer.pages.dev`.

**Option B — from GitHub:** *Create → Pages → Connect to Git*, pick the repo, set **Framework preset: None**, **Build command: (empty)**, **Output directory: `/`**, *Save and Deploy*. Every push redeploys.

Both hosts serve HTTPS, which iPhone PWAs require.

---

## Install on iPhone

1. Open your deployed URL in **Safari**.
2. Tap **Share** (square with an up-arrow).
3. Tap **Add to Home Screen** → **Add**.
4. Launch **Memory** from the Home Screen. It opens full-screen, without the Safari bars.
5. Open it once while online. After that it works with **no connection at all** (airplane mode is fine).

**Updating:** when you deploy a new version, bump `CACHE_VERSION` in `service-worker.js`. The next time you open the app, it shows **"An update is ready → Reload"**.

---

## Where your data is stored (privacy)

- Everything lives in **IndexedDB** (database name `memory-trainer`) inside your browser, **on this device only**, tied to the site's address.
- There's no server, account, sync, analytics, telemetry or tracker. After the first load, the app makes **no network requests**. A Content-Security-Policy in `index.html` blocks connections to any other site.
- The app asks the browser for **persistent storage** so the data isn't evicted under storage pressure.
- **iPhone caveat:** Safari can clear data for websites you haven't visited in a while, unless they're added to the Home Screen. **Install the app**, and **back up regularly**. Deleting the Home Screen app deletes its data.
- Backups are plain JSON files that you control. On iPhone, choose *Save to Files* (iCloud Drive or *On My iPhone*).
- The data for `github.io` and `pages.dev` is separate. If you move hosts, back up first and restore at the new address.

---

## Features

| Area | What you get |
|---|---|
| Decks | Create, rename, describe, duplicate, export, reset progress, delete |
| Cards | Question, answer, notes (Markdown), category, tags, favorite |
| Study mode | Reveal → Correct / Incorrect. Remaining, correct %, streak, best streak, session timer. Missed cards come back later in the session |
| Study sources | All · Due · Learning · Weak · New · Favorites · Surprise Me (20 random) · by deck · by tag · retry missed |
| Quiz mode | 4-choice multiple choice. Distractors come from the same category, then the same deck, then any deck. Score, %, average response time, end-of-session report |
| Search | Instant filtering across question, answer, notes, category and tags, filterable by deck |
| Tags | Study or quiz any tag (Security, Microsoft, OT, Networking, Commands…) |
| Backup / restore | One-click backup with timestamp; restore by merging or replacing |
| Import / export | Full-database JSON, per-deck JSON; Quizlet-style bulk paste (tab, `|`, ` - `, `;`, `,`) |
| Statistics | Totals, state breakdown, accuracy, streak, time studied, daily / weekly / monthly charts, per-deck mastery, recent sessions |
| Reminders | Local notifications (installed app, iOS 16.4+) plus a calendar `.ics` daily reminder |
| UI | Mobile-first, light/dark/system theme, 3 text sizes, 52px+ buttons, VoiceOver labels, reduced-motion support |
| Keyboard | Space reveal · 1/2 wrong/right · 1–4 quiz · N quick add · / search · S study · G+H/D/T navigation · ? help |

### About reminders (honest limits)
Without a push server, iOS can't wake a web app on a schedule. Avoiding servers is the point of this app. In-app notifications only fire while the app is open or recently used. For a reminder that **always** fires, use **Settings → Add daily reminder to Calendar**. It creates a repeating Calendar event with an alert.

---

## How the spaced repetition works

This is a simplified **SM-2** (the algorithm family used by SuperMemo and Anki), adapted to two buttons.

Each card stores an **interval** (days until it's shown again), an **ease** (growth multiplier, starts at 2.5), **reps** (consecutive correct answers), **lapses** (times forgotten after being learned) and a **due** time.

**Correct answer**
1. 1st correct → due again in **10 minutes** (checks it really stuck)
2. 2nd → **1 day**
3. 3rd → **3 days**
4. After that → **previous interval × ease**, e.g. 3 → 8 → 21 → 57 → 160 days
5. Ease goes up by 0.05 (max 3.0), so cards you always get right spread out faster.

**Incorrect answer**
- Interval and reps reset to 0, and the card is due again in 1 minute (it also reappears later in the current session).
- Ease drops by 0.2 (min 1.3), so the card grows more slowly from now on.
- If the card had already graduated (interval ≥ 1 day), it counts as a **lapse**.

**Card states** (derived from the interval, so they're always consistent)

| State | Meaning |
|---|---|
| New | Never answered |
| Learning | Interval under 7 days |
| Review | 7–20 days |
| Mastered | 21+ days |

**Weak cards** = 2+ lapses, or ease below 2.0, or under 60% accuracy after 3+ attempts.

**Due session** = overdue cards first (most overdue first), then up to *N* new cards (default 15, set in Settings), capped at the session size (default 30).

Long intervals get ±5% random "fuzz" so cards added together don't all come due on the same day. Quiz answers also update the schedule: picking the right option is weaker evidence than recall, but a miss is a real signal.

---

## Data model

Defined and documented in `js/db.js`:

```js
deck    { id, name, description, color, createdAt, updatedAt, lastStudiedAt }
card    { id, deckId, question, answer, notes, category, tags: [],
          favorite,
          srs:   { state, interval, ease, reps, lapses, due, lastReviewed },
          stats: { correct, incorrect, totalMs, lastResult },
          createdAt, updatedAt }
tag     { name /* lowercase key */, label /* original casing */, createdAt }
session { id, mode /* study|quiz */, source, startedAt, endedAt,
          total, correct, incorrect, bestStreak, avgMs, durationMs }
daily   { date /* "YYYY-MM-DD" local */, reviews, correct, timeMs }
meta    { key, value }   // settings, lastBackupAt, initialized, schemaVersion
```

Key design decisions:
- **Random UUIDs** instead of auto-increment numbers, so exports from different devices merge without ID collisions.
- **`updatedAt` on every record**, so the newest version wins during a merge.
- **SRS state embedded in the card**: a card and its schedule are always saved together in one transaction.
- **Daily aggregates** instead of a row per answer: charts stay fast over years, and re-importing the same backup doesn't double the stats (merge keeps the per-day maximum).

### Import / merge rules
- Records are matched by `id`. Unknown records are added.
- When a record exists on both sides, the **newer `updatedAt` wins**.
- An import never deletes anything. Only *Restore & replace everything* wipes data first, and it asks for confirmation.
- Cards whose deck is missing go into an "Imported <date>" deck.
- A plain JSON array like `[{"question":"…","answer":"…","tags":["Security"]}]` is also accepted.

### Export format
```json
{
  "app": "memory-trainer",
  "schemaVersion": 1,
  "exportedAt": "2026-11-19T15:00:00.000Z",
  "decks": [...], "cards": [...], "tags": [...],
  "sessions": [...], "daily": [...], "meta": [{ "key": "settings", "value": {...} }]
}
```

---

## Sample deck

On first launch, a **"Starter: Networking & Security"** deck (25 cards) is added. It covers ports, RFC 1918 ranges, Windows and Linux commands, NIST incident response, phishing triage, Entra PIM / Conditional Access, the Purdue model and the 3-2-1 backup rule. It shows off categories, tags, favorites, Markdown notes and Quiz mode. Delete it whenever you like, or reload it under **Settings → Load sample deck**.
