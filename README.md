# SubSinhala — Context-aware English → Sinhala Subtitle Translator

Built with **Next.js 16**, **TMDB**, **DeepSeek**, **TOON**, and **Neon Postgres**.

## Features

- **User accounts** — signup/login with email + password. Session cookies last 7 days.
- **Free tier** — 1 subtitle translation per day (UTC midnight reset).
- **Premium tier** — unlimited translations (granted by admin).
- **Admin panel** — manage users, promote/demote roles, view usage stats.
- **Clean UI** — no API keys or technical jargon visible to end users.
- **Context-aware translation** — researches movie plot, characters, tone, and culture before translating.
- **TMDB integration** — movie search with posters, cast, genres.
- **AI fallback** — if TMDB isn't configured, DeepSeek identifies the movie from a description.
- **Glossary editor** — override any locked term; overrides persist per-movie.
- **Per-cue re-translate** — fine-tune any line with an optional instruction.
- **TOON encoding** — 30% smaller payloads to DeepSeek, saving tokens.
- **TMDB attribution** — logo in footer per TMDB API terms.

## Setup

### 1. Get the required credentials

| What | Where | Required? |
|------|-------|-----------|
| **Neon database** | https://neon.tech (free tier) | Yes — for user accounts, usage tracking, and brief cache |
| **DeepSeek API key** | https://platform.deepseek.com/api_keys | Yes — powers research + translation |
| **TMDB API key** | https://www.themoviedb.org/settings/api (v4 Read Access Token) | Optional — enables movie search with posters. Falls back to AI identification if unset. |

### 2. Configure environment variables

Copy `.env.example` to `.env.local` (dev) or set in Netlify UI (prod):

```env
DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
DEEPSEEK_API_KEY="sk-..."
TMDB_API_KEY="eyJhbGciOiJIUzI1NiJ9..."        # optional

# Auth — generate with: openssl rand -hex 32
AUTH_SECRET="your-random-32-char-hex-string"

# Initial admin account (seeded on first server start)
ADMIN_EMAIL="you@example.com"
ADMIN_PASSWORD="choose-a-strong-password"
ADMIN_NAME="Your Name"
```

### 3. Initialize the database

```bash
bun install
bun run db:push   # creates tables in Neon
```

### 4. Run locally

```bash
bun run dev
```

Open http://localhost:3000. The first server start will seed the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Log in with those credentials.

### 5. Deploy to Netlify

1. Push the repo to GitHub
2. Connect it on Netlify (auto-detects `netlify.toml`)
3. Set all env vars in Site settings → Environment variables
4. Deploy — the admin account will be seeded automatically on first cold start

## How it works

### User roles

- **FREE** — 1 subtitle translation per UTC day. Can use all features (research, glossary, fine-tune) but limited throughput.
- **PREMIUM** — unlimited translations. Granted by admin.
- **ADMIN** — unlimited + access to the admin panel at `#admin`.

### Daily quota

A "translation" = one .srt/.vtt file fully translated end-to-end (clicking "Translate All" and completing). The quota is enforced server-side via the `DailyUsage` table (one row per user per UTC day). Per-cue re-translations do NOT count against the quota (they're fine-tuning, not new translations).

### Admin panel

Navigate to `/#admin` (or click the "Admin" button in the header if you're an admin). The panel shows:
- Total / premium / admin user counts
- Translations today + last 7 days
- Daily breakdown bar chart
- User table with search, role dropdown (Free/Premium/Admin), per-user usage stats
- Recent translation jobs

### Translation pipeline

1. **Movie lookup** — TMDB search, or AI fallback if TMDB isn't configured
2. **Research** — DeepSeek analyses the movie and produces a locked glossary (cached in DB per movie)
3. **Glossary** — user can override any locked term
4. **Translation** — .srt/.vtt split into batches, sent to DeepSeek as TOON payloads with the glossary + rolling context
5. **Fine-tune** — per-cue re-translate with optional instruction

## File structure

```
src/
├─ app/
│  ├─ page.tsx                         # SPA: landing → login → app → admin
│  └─ api/
│     ├─ auth/{login,signup,logout,me}/   # auth endpoints
│     ├─ admin/{users,stats}/             # admin-only endpoints
│     ├─ jobs/record/                     # records a completed translation
│     ├─ usage/                           # current user's quota
│     ├─ tmdb/{search,details}/           # movie lookup (TMDB)
│     ├─ ai-search/                       # AI fallback for movie lookup
│     ├─ research/                        # streams DeepSeek research brief
│     ├─ translate/                       # batched translation
│     ├─ translate-cue/                   # per-cue re-translate
│     └─ brief/{get,overrides}/           # cached brief + glossary overrides
├─ components/
│  ├─ auth-card.tsx                      # login/signup form
│  ├─ admin-panel.tsx                    # admin UI
│  ├─ movie-search.tsx                   # TMDB + AI search
│  ├─ movie-context-card.tsx             # selected movie display
│  ├─ research-panel.tsx                 # live-streaming research brief
│  ├─ glossary-editor.tsx                # glossary override editor
│  └─ subtitle-workspace.tsx             # upload + translate + fine-tune
├─ hooks/
│  ├─ use-auth.ts                        # shared auth state (singleton)
│  └─ use-usage.ts                       # daily quota status
├─ lib/
│  ├─ auth.ts                            # bcrypt + signed session cookies
│  ├─ usage.ts                           # quota checking + recording
│  ├─ brief-cache.ts                     # Prisma cache helpers
│  ├─ deepseek.ts                        # DeepSeek client
│  ├─ tmdb.ts                            # TMDB client
│  ├─ subtitle.ts                        # SRT/VTT parser
│  ├─ toon.ts                            # TOON encoder/decoder
│  └─ translate-context.ts               # research + translation logic
└─ instrumentation.ts                    # seeds admin on server startup
```

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.
TMDB logos and data are © TMDB and their respective owners.
