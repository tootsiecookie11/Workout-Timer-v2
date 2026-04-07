# PRD: Galawgaw — Notion-Powered Workout Timer SaaS

**Version**: 0.1 (Draft)
**Status**: In Review
**Date**: 2026-04-07
**Author**: Product Team

---

## 1. Overview

Galawgaw is a Progressive Web App (PWA) workout and fitness timer that uses the user's own Notion workspace as its database. Instead of storing data on a proprietary backend, users connect their Notion account, duplicate a master template workspace, and Galawgaw reads and writes to their personal copy. The result is a zero-lock-in, privacy-first fitness tool where users always own their data.

### Elevator Pitch

> "A pro-grade workout timer with a graph-based runtime engine, Notion as your personal database, and zero vendor lock-in."

---

## 2. Problem Statement

Fitness timer apps fall into two buckets:

1. **Simple but dumb** — basic interval timers with no workout structure, no history, no adaptation.
2. **Powerful but closed** — apps like Whoop, Strong, and FitBod lock your data in proprietary silos. If you leave, your data leaves with you (if they let you export at all).

There is no app that offers:
- A structured, programmable workout engine (blocks, branching, DSL)
- Intelligent adaptation based on history and fatigue
- User data ownership via a tool they already use (Notion)

Galawgaw fills this gap.

---

## 3. Target Users

### Primary: Self-Optimizing Athletes
- Ages 20–40
- Already use Notion for life/work organization
- Train 3–5x per week (HIIT, strength, circuits)
- Frustrated by data silos; value transparency and control
- Comfortable with mild technical complexity (e.g., willing to duplicate a Notion template)

### Secondary: Personal Trainers & Coaches
- Manage multiple clients
- Need to define reusable workout blocks and programs
- Want to share templates without a separate coaching platform subscription

### Out of Scope for MVP
- Beginners who need guided onboarding
- Group class / gym-facing kiosk use

---

## 4. Goals & Success Metrics

### North Star Metric
**Weekly Active Workouts Synced to Notion** — measures both engagement (workouts completed) and core value delivery (Notion sync working).

### MVP Launch Targets (90 days post-launch)
| Metric | Target |
|--------|--------|
| Connected Notion workspaces | 500 |
| Workouts completed per connected user / week | ≥ 3 |
| Sync success rate | ≥ 99% |
| Onboarding completion rate (connect → first workout) | ≥ 60% |
| D7 retention | ≥ 40% |

### Guardrail Metrics
- Notion API error rate < 1%
- P95 timer accuracy drift < 50ms per 60s session
- Backend latency P95 < 300ms

---

## 5. Core Features

### 5.1 Multi-Mode Timer System

A segmented control at the top level switches between three modes. The selection persists across sessions.

**Modes:**

| Mode | Description |
|------|-------------|
| **Preset Timer** | Loads a pre-configured timer from the user's Notion `Preset Timers` database. Supports AMRAP, EMOM, Tabata, and custom interval structures. |
| **Custom Timer** | In-app builder for ad-hoc sessions. User defines rounds, work/rest intervals, and exercise blocks without touching Notion. |
| **Stopwatch** | Lap-capable, no countdown. Used for open-ended effort or AMRAP tracking. |

**Acceptance Criteria:**
- Mode switch is immediate with no loading state visible to user.
- Active workout cannot be interrupted by mode switch without a confirmation dialog.
- Selected mode is restored on app reload.

---

### 5.2 Block-Based Workout Architecture

Workouts are not flat lists of exercises. They are **blocks** — reusable, composable units that can be nested, repeated, and conditioned.

**Block Types:**

| Type | Description |
|------|-------------|
| `exercise` | A single movement with duration or rep count |
| `rest` | Passive rest with optional audio cue |
| `superset` | Two or more exercises with no rest between them |
| `circuit` | A group of exercises repeated N times |
| `amrap` | A block group executed for a fixed duration, as many rounds as possible |
| `emom` | One exercise per minute, on the minute |
| `conditional` | A block that executes only if a condition evaluates to true (see Graph Runtime Engine) |

**Notion Schema for `Workout Blocks Library`:**
```
Name            (title)
Type            (select: exercise | rest | superset | circuit | amrap | emom | conditional)
Duration        (number, seconds)
Reps            (number, optional)
Rest After      (number, seconds)
Cue Audio       (select)
Tags            (multi-select: upper | lower | core | cardio | mobility)
DSL             (text, optional — overrides block if present)
```

**Acceptance Criteria:**
- Blocks are resolved at runtime, not build time, enabling last-minute template edits.
- A workout with 0 blocks gracefully shows an empty state, not a crash.
- Nested blocks (e.g., circuit inside a superset) resolve to depth ≤ 5.

---

### 5.3 Smart Queue Generator

When a user starts a workout, the engine converts the block tree into a flat, ordered queue of **steps**. This is the execution plan.

**Queue Generation Rules:**
1. Traverse the block tree depth-first.
2. Expand repeating blocks (e.g., circuit × 3) into their N copies.
3. Inject rest steps between blocks per `rest_after` values.
4. Annotate each step with: `step_index`, `block_id`, `type`, `duration_ms`, `label`, `audio_cue`.
5. Conditional blocks are evaluated lazily at step execution time (not at queue generation time).

**Output (internal step object):**
```json
{
  "step_index": 4,
  "block_id": "uuid",
  "type": "exercise",
  "label": "Push-ups",
  "duration_ms": 40000,
  "audio_cue": "beep_start",
  "meta": { "round": 2, "set": 1 }
}
```

**Acceptance Criteria:**
- Queue is generated in < 100ms for workouts up to 200 steps.
- Queue is immutable once a workout session starts (edits to Notion do not affect a live session).
- Queue preview (step list) is visible to user before starting.

---

### 5.4 Event-Driven Runtime Engine

The timer engine is a state machine. The UI subscribes to engine events and re-renders only when state changes. There is no polling.

**Engine States:**
```
IDLE → COUNTDOWN → ACTIVE → TRANSITIONING → PAUSED → COMPLETE
```

**Engine Events (emitted to UI):**
| Event | Payload |
|-------|---------|
| `step:start` | current step object |
| `step:tick` | `{ elapsed_ms, remaining_ms }` |
| `step:complete` | completed step object |
| `session:paused` | timestamp |
| `session:resumed` | timestamp |
| `session:complete` | summary object |
| `transition:start` | `{ from_step, to_step, type }` |
| `countdown:tick` | `{ remaining_seconds }` (3-2-1) |

**Acceptance Criteria:**
- UI never queries engine state; it only reacts to events.
- Missed events during tab-background are caught on `visibilitychange` via delta recalculation.
- Engine can be paused and resumed without time drift.

---

### 5.5 Delta-Based Accurate Timer System

The engine does not rely on `setInterval` for tracking elapsed time. Intervals drift. Instead:

**Algorithm:**
1. On step start, record `start_epoch = Date.now()`.
2. `setInterval` fires at ~100ms as a "heartbeat" to trigger UI repaints.
3. Each tick calculates `elapsed = Date.now() - start_epoch`.
4. `remaining = duration_ms - elapsed`.
5. If `remaining ≤ 0`, immediately advance to next step.

**Tab Suspension Handling:**
- On `visibilitychange` (tab regains focus), recalculate elapsed time since last known epoch.
- If elapsed > remaining, skip the step and advance to the correct position in the queue.
- Emit a `session:skipped_steps` event so the UI can display "X steps skipped while away."

**Acceptance Criteria:**
- Timer drift ≤ 50ms per 60-second session measured against `performance.now()`.
- No step is skipped silently; all skips are logged in the session result JSON.
- Accuracy is maintained across device sleep/wake cycles when tab is active.

---

### 5.6 Smart Audio Cue System

Audio cues are triggered by engine events, not by the UI layer.

**Cue Types:**
| Cue ID | Trigger | Sound |
|--------|---------|-------|
| `beep_start` | `step:start` on exercise | Short ascending beep |
| `beep_rest` | `step:start` on rest | Low tone |
| `beep_countdown` | `countdown:tick` | Tick for each second |
| `beep_final` | `countdown:tick` at 1s | Distinct final beep |
| `chime_complete` | `session:complete` | Completion chime |
| `voice_exercise` | `step:start` | TTS: exercise name (optional) |

**Implementation Notes:**
- Use Web Audio API for reliability over `<audio>` tags.
- Pre-decode audio buffers on session start (not on each cue).
- Audio is suppressible globally via a mute toggle that persists to localStorage.
- Voice cues use the browser's SpeechSynthesis API; if unavailable, fall back to beep.

**Acceptance Criteria:**
- Audio cues play within 50ms of event emission.
- Mute toggle takes effect within the current step, not just the next one.
- No audio cue plays after `session:complete`.

---

### 5.7 Transition Overlay System

Between workout steps, a full-screen overlay appears to prepare the user.

**Overlay Types:**
| Overlay | Trigger | Content |
|---------|---------|---------|
| `exercise_start` | Moving into an exercise step | Exercise name, duration, set/round indicator |
| `rest_start` | Moving into a rest step | "Rest" label, countdown, next exercise name |
| `countdown` | 3-2-1 before first step | Animated 3-2-1 countdown |
| `session_complete` | After final step | Summary stats (time, steps, cals est.) |
| `halfway` | At 50% of total session duration | Motivational mid-session flash |

**Design Constraints:**
- Overlays are non-dismissible during countdown (prevents accidental skip).
- After countdown completes, overlay auto-dismisses and step begins.
- Overlay uses the design system's midnight violet + celadon palette.

**Acceptance Criteria:**
- Overlay appears within one animation frame of the triggering event.
- Overlay includes the name of the upcoming exercise so users can prepare.
- Transition overlays can be disabled in settings (for power users who prefer no interruptions).

---

### 5.8 Graph Runtime Engine

Standard timers are linear. Galawgaw's engine supports a **directed acyclic graph (DAG)** of blocks, enabling branching, conditional paths, and adaptive decisions.

**Graph Node Types:**
| Node | Description |
|------|-------------|
| `start` | Entry point of the workout graph |
| `block` | A workout block (see §5.2) |
| `condition` | Evaluates a boolean expression; routes to one of two child nodes |
| `merge` | Rejoins branches into a single path |
| `end` | Terminal node |

**Condition Variables Available:**
- `session.elapsed_ms` — total time elapsed
- `user.fatigue_score` — computed from recent history (see §5.10)
- `block.completion_rate` — % of reps completed in previous block
- `user.input.difficulty` — user-rated difficulty after a block (0–10)

**Example Use Case:**
> After a max-effort squat block, if the user rates effort > 8, route to a lighter alternative; otherwise continue to the heavy block.

**Acceptance Criteria:**
- Graph engine resolves in correct topological order.
- Cycles in the graph are detected at load time and rejected with a clear error.
- Condition evaluation never blocks the timer tick.

---

### 5.9 Workout DSL

Advanced users and coaches can define workouts in a text-based Domain-Specific Language instead of clicking through a block editor.

**DSL Sample:**
```
workout "Morning Circuit" {
  rounds: 3
  rest_between_rounds: 90s

  block "Push Day" {
    exercise "Push-ups" for 40s
    rest 20s
    exercise "Dips" for 30s
    rest 15s
  }

  if fatigue > 7 {
    block "Light Finisher" {
      exercise "Band Pull-Aparts" for 60s
    }
  } else {
    block "Heavy Finisher" {
      exercise "Weighted Dips" reps:8 sets:3
    }
  }
}
```

**Parser Requirements:**
- DSL is parsed server-side (Cloudflare Worker) before execution — never eval'd on client.
- Parser produces an AST that maps to the internal block/graph model.
- Invalid DSL returns structured errors with line/column references.
- DSL is stored in Notion as a `text` property on workout templates.

**Acceptance Criteria:**
- DSL parse errors are shown inline in the editor with line highlighting.
- A valid DSL document always produces a valid graph (or parser rejects it).
- DSL supports all block types defined in §5.2.

---

### 5.10 Workout Intelligence

The system adapts workouts dynamically based on user history, perceived effort, and fatigue indicators.

**Data Inputs:**
- `workout_logs` from Notion (last 30 days)
- User-provided RPE (Rate of Perceived Exertion, 1–10) after each session
- Completion rate per block (% of reps/duration completed)
- Rest-day gaps between sessions

**Adaptation Outputs:**
| Signal | Adaptation |
|--------|------------|
| High fatigue score | Reduce volume 15–20%, flag blocks as "optional" |
| Low completion rate (< 70%) on last session | Reduce intensity of same blocks |
| 3+ consecutive high-RPE sessions | Insert a deload suggestion |
| Long rest gap (> 5 days) | Reduce intensity for first block, increase gradually |
| Consistent high completion (> 95%) | Suggest progression (add weight, reduce rest) |

**Fatigue Score Algorithm (v1, simple):**
```
fatigue = (avg_rpe_last_3_sessions / 10) * 0.5
        + (1 - avg_completion_last_3) * 0.3
        + (sessions_last_7_days / 7) * 0.2
```

**Acceptance Criteria:**
- Intelligence suggestions are displayed before workout starts, not mid-session.
- User can override any adaptation suggestion.
- Fatigue score is visible in a "readiness" indicator on the home screen.
- Intelligence engine degrades gracefully with < 3 sessions of history (shows "Not enough data").

---

### 5.11 Workout Program Engine

Programs are multi-week training plans composed of workout templates assigned to specific days.

**Notion Schema for `Workout Programs`:**
```
Name              (title)
Duration Weeks    (number)
Goal              (select: strength | endurance | fat_loss | mobility | general)
Days              (relation → Program Days database)
```

**Notion Schema for `Program Days`:**
```
Week              (number)
Day               (number, 1–7)
Workout Template  (relation → Workout Templates)
Notes             (text)
Is Rest Day       (checkbox)
```

**Engine Behavior:**
1. On app open, check if user has an active program.
2. Calculate today's program day based on program start date.
3. Pre-load the assigned workout template.
4. After session complete, mark the program day as done in Notion.

**Acceptance Criteria:**
- Active program is surfaced on the home screen as the primary CTA.
- Program progress (week X / Y, day Z) is visible at a glance.
- Missed days are logged but do not shift the program schedule (user can manually mark as rest).
- Users can be enrolled in only one program at a time (MVP).

---

## 6. Architecture

### 6.1 System Diagram

```
User Browser (PWA)
      │
      │  HTTPS
      ▼
Cloudflare Workers (Backend)
      │              │
      │              │  KV Cache
      │              ▼
      │         Upstash Redis (Rate Limiting)
      │
      │  Notion API (OAuth)
      ▼
User's Notion Workspace
  ├── Preset Timers DB
  ├── Workout Blocks Library DB
  ├── Workout Templates DB
  ├── Workout Logs DB
  └── Workout Programs DB
```

### 6.2 Notion as User CMS

The master Notion template workspace (maintained by Galawgaw) contains:
- Example databases with pre-built schemas
- Sample data: beginner presets, HIIT blocks, strength programs
- Property descriptions as Notion database comments

**User Onboarding Flow:**
```
1. User visits galawgaw.app
2. Signs in with Google (Supabase Auth)
3. Prompted to duplicate Galawgaw Notion template
4. Clicks "Connect Notion" → Notion OAuth flow
5. Selects which workspace/database to use
6. App verifies schema compatibility
7. Fetches initial data → cached in Cloudflare KV
8. User selects a workout → session begins
```

### 6.3 Data Ownership Contract

- All workout data lives in the user's Notion workspace.
- Galawgaw's backend stores only: `user_id`, `notion_access_token` (encrypted), `selected_database_ids`, `last_sync_timestamp`.
- If a user disconnects their Notion account, Galawgaw deletes the access token and stops syncing. Their Notion data is untouched.
- Users can export their Notion databases at any time independently of Galawgaw.

### 6.4 Sync Strategy

**Read path (Notion → App):**
- On login: fetch and cache all databases to Cloudflare KV.
- TTL: 5 minutes for frequently changing data (logs), 30 minutes for templates/blocks.
- On cache miss: fetch from Notion API, update cache.
- Manual "Sync" button available in settings for forced refresh.

**Write path (App → Notion):**
- Workout results are accumulated locally in memory during session.
- On session complete: serialize to `result_json`, store in IndexedDB as write queue.
- Background sync: flush write queue to Notion in a single batch API call.
- Retry with exponential backoff on failure (max 3 attempts).
- Never write to Notion mid-session.

**result_json Schema:**
```json
{
  "session_id": "uuid",
  "workout_name": "Morning Circuit",
  "started_at": "2026-04-07T07:30:00Z",
  "completed_at": "2026-04-07T08:00:00Z",
  "duration_ms": 1800000,
  "steps_completed": 24,
  "steps_skipped": 0,
  "rpe": 7,
  "fatigue_score": 0.42,
  "blocks": [
    {
      "block_id": "uuid",
      "label": "Push Day",
      "completion_rate": 1.0,
      "elapsed_ms": 360000
    }
  ],
  "adaptations_applied": [],
  "timer_mode": "preset"
}
```

---

## 7. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React + Vite + PWA | Familiar ecosystem, offline support, installable |
| Styling | Tailwind CSS | Rapid iteration, design token-friendly |
| State | Zustand | Lightweight, event-bus-friendly |
| Backend | Cloudflare Workers | Edge latency, cost-efficient, no cold starts |
| Auth | Supabase Auth (Google + Notion OAuth) | Managed auth, Notion OAuth built-in |
| Cache | Cloudflare KV | Persistent, globally distributed read cache |
| Rate Limiting | Upstash Redis | Serverless-compatible, per-user counters |
| Database | Notion API | User-owned data layer |
| Offline Queue | IndexedDB (via idb) | Durable write queue for sync batching |
| Audio | Web Audio API | Low-latency cue playback |

---

## 8. Security

### 8.1 Authentication
- Google OAuth via Supabase handles identity.
- Notion OAuth handles Notion access; tokens are stored server-side only (Cloudflare Workers secrets / encrypted KV).
- JWTs issued by Supabase are validated on every backend request.
- Notion access tokens are never sent to the client.

### 8.2 API Protection
- All Notion API calls are proxied through the Cloudflare Worker. The Notion token is never exposed to the browser.
- Input validation on all Worker endpoints using Zod schemas.
- DSL input is parsed server-side; no client-side `eval` or `Function()` calls.

### 8.3 Rate Limiting (Upstash Redis)
- Per-user: 60 API requests/minute, 500/hour.
- Per-IP: 200 requests/minute (unauthenticated).
- Write-to-Notion: max 10 syncs/hour per user (batch enforced).
- Abuse protection: captcha challenge after 5 consecutive 429 responses.

### 8.4 Input Sanitization
- All user-facing text fields sanitized (DOMPurify on client, strip-html on server).
- DSL parser runs in a sandboxed function with no access to runtime globals.
- Notion property values are never interpolated into raw API requests — always structured via the Notion SDK.

---

## 9. Export & Portability

Users can export their data from within the app in multiple formats:

| Export Type | Formats | Target Tools |
|-------------|---------|--------------|
| Workout Logs | JSON, CSV, Markdown | Google Sheets, Obsidian, Notion import |
| Workout Templates | JSON, Markdown | Obsidian, sharing with coaches |
| Preset Timers | JSON, CSV | Backup, migration |
| Full Workout History | JSON | Custom analysis |

Export is available even if Notion sync is disconnected (reads from local IndexedDB cache).

---

## 10. Out of Scope (MVP)

The following are explicitly deferred to post-MVP:

- **Social / sharing** — no public profile, no sharing workouts with friends
- **Video guidance** — no embedded exercise video or form check
- **Wearable integration** — no Apple Watch, Garmin, or HR monitor support
- **Paid plans / monetization** — MVP is free to validate retention and core loop
- **Native mobile apps** — PWA only for MVP; native considered in v2
- **Multi-language support** — English only
- **Coach dashboard** — no multi-client management UI
- **Calorie tracking** — estimated calories in result JSON only, not a first-class feature
- **Community templates marketplace** — no public block/workout library

---

## 11. Open Questions & Risks

| # | Question / Risk | Owner | Status |
|---|----------------|-------|--------|
| 1 | Notion API rate limits: 3 req/s per integration. Will batching be sufficient at scale? | Eng | Open |
| 2 | What happens when a user modifies their Notion schema post-connection? Need schema validation on each sync. | Eng | Open |
| 3 | Notion template duplication UX is manual — can we deeplink to a pre-filled duplicate? | Product | Open |
| 4 | Graph engine: what is the max graph complexity we'll support at MVP? Cap at 50 nodes? | Eng | Open |
| 5 | PWA audio context on iOS requires user gesture to unlock. How do we handle the first-tap requirement? | Eng | Open |
| 6 | DSL sandbox: evaluate Cloudflare Workers Durable Objects vs pure parsing approach. | Eng | Open |
| 7 | Supabase + Cloudflare Workers: JWT verification latency at edge needs profiling. | Eng | Open |
| 8 | Program engine: what if the user's program day template is deleted from Notion mid-program? | Product | Open |

---

## 12. Design Tokens (Reference)

From existing UI explorations:

| Token | Value | Usage |
|-------|-------|-------|
| `background` | `#2D1E2F` | App background (midnight violet) |
| `primary` | `#A9E5BB` | Celadon — CTAs, active state, progress |
| `secondary` | `#feb246` | Amber — secondary actions |
| `tertiary` | `#ff8481` | Coral-red — alerts, destructive |
| `on-surface` | `#ede4fa` | Primary text |
| `on-surface-variant` | `#afa8bc` | Secondary text |
| `surface-container` | `#231826` | Card backgrounds |
| `headline-font` | Space Grotesk | All headings |
| `body-font` | Inter | All body copy |

---

## 13. Milestones

### Phase 0 — Foundation (Weeks 1–2)
- [ ] Supabase auth (Google login)
- [ ] Notion OAuth integration
- [ ] Notion template published and duplicatable
- [ ] Cloudflare Workers scaffold with KV cache
- [ ] Upstash Redis rate limiter middleware

### Phase 1 — Core Timer (Weeks 3–5)
- [ ] Delta-based timer engine
- [ ] Multi-mode timer (Preset, Custom, Stopwatch)
- [ ] Block-based workout architecture
- [ ] Smart queue generator
- [ ] Event-driven UI with Zustand
- [ ] Basic audio cues (Web Audio API)

### Phase 2 — Notion Sync (Weeks 6–7)
- [ ] Read: fetch Preset Timers and Workout Templates from Notion
- [ ] Write: session result JSON to Notion Workout Logs
- [ ] IndexedDB write queue + background sync
- [ ] Manual sync trigger + sync status indicator

### Phase 3 — Advanced Engine (Weeks 8–10)
- [ ] Transition overlay system
- [ ] Workout DSL parser (server-side)
- [ ] Graph runtime engine
- [ ] Workout intelligence (fatigue score + adaptations)

### Phase 4 — Programs & Export (Weeks 11–12)
- [ ] Workout Program Engine
- [ ] Program day tracking in Notion
- [ ] Export (JSON, CSV, Markdown)
- [ ] PWA installability + offline mode

### Phase 5 — Hardening (Weeks 13–14)
- [ ] Abuse protection (captcha, per-user quota)
- [ ] Schema validation on Notion connect
- [ ] Error states and recovery flows
- [ ] Performance profiling (timer accuracy, API latency)
- [ ] Closed beta launch
