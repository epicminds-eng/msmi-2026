# MSMI 2026 — Handoff (updated 28 July)

Paste this whole file into a new chat as your first message.
This supersedes the earlier handoff — the redesign described there is now built.

---

## 1. What this is

A phone app for a Michigan golf trip, **Aug 2–6 2026**, based at Treetops Resort,
Gaylord MI. Built by Chad Schurecht, shared with all 24 players.

**Live:** https://epicminds-eng.github.io/msmi-2026/
**Install page:** https://epicminds-eng.github.io/msmi-2026/install/
**Repo:** `epicminds-eng/msmi-2026` (public) · local clone `~/code/msmi-2026`

Installable PWA (iOS Add to Home Screen, Android Install), fully offline via a
service worker. Single `index.html`, no build step, no framework.

**Status: finished and in testing.** Nick Albers — who runs the outing and wrote
both source spreadsheets — has tested it and is sending it to all 24 players on
**Friday**. He estimates three quarters of the field will use it.

---

## 2. Hard rules — breaking these breaks things

**`git push` is hard-denied for Claude Code** in `~/.claude/settings.json`.
Claude Code commits; Chad pushes:

```bash
cd ~/code/msmi-2026 && git push
```

**Every commit touching `index.html` must bump `CACHE_VERSION` in `sw.js` in the
same commit.** The service worker is cache-first — skip it and the phone serves a
stale build. Currently v16. There's a comment at the top of `sw.js` stating this.
It has bitten us twice.

**Never use the `deploy` zsh function.** It copies from `~/Downloads` and will
overwrite Claude Code's work. Leftover from before hosting.

**Files handed over in chat are not on Chad's Mac until he downloads them.** This
stalled us three separate times. If a prompt references a file, say so explicitly.

**Never rely on `body` to carry the page background.** Chad's preview doesn't
paint it, which produced a white-background / invisible-heading bug twice. Every
page sits in a wrapper with its own `background: var(--bg); min-height: 100vh`.
Test by injecting `body{background:#fff !important}`.

**Canonical EpicMinds logos:**
`~/Library/Mobile Documents/com~apple~CloudDocs/Epicminds/Brand/02_Logos/`
Everything under `03_Archive` is legacy — a `find` turns up 60+ lockups.

---

## 3. How Chad works

- Terse and direct. Working output over discussion.
- **One command per box**, labelled **TERMINAL** or **CLAUDE CODE** (with model
  and effort). Numbered steps. He does not parse action items buried in prose.
- Claude Code prompts must be complete and copy-pasteable in one block.
- He reviews on his phone and sends screenshots. **Trust his screenshots over
  your own rendering** — several bugs were only visible on device.
- He'll say "save that" when he wants an option kept but not shipped.

**Claude Code runs on Sonnet 5, high effort, and has been excellent.** It caught a
rotated par array, a CSS `[hidden]` override, a service-worker font-caching gap, a
`dataset` camelCase mismatch, an undefined function that crashed the scorecard,
and two of my own arithmetic errors. **Always require it to assert rather than
eyeball, and to prove a new assertion fails against the old data before trusting
it.** It has twice caught its own bad tests.

---

## 4. Data — all verified, do not re-derive

All eight courses have complete par, hole handicap, and yardages for every tee,
each cross-checked against at least one independent source.

Masterpiece, Signature, Premier, Tradition, Threetops — printed Treetops PDFs.
Black Lake and Tribute — 18Birdies. Classic — printed Otsego card.

**24 players**, each with an index, per-course handicaps for every tee, which of
the 9 rounds they play, and a gender flag. Dami Mui is the only woman — she sees
the (L)-rated tees, which are the *same physical tees* rated for women, not
different tee boxes.

**Buy-ins** at $20/round: 5×$180, 5×$160, 9×$140, 2×$120, 3×$100 = **$3,500**.
Chad is $180.

**Friday (The Ravines, Saugatuck) is deliberately excluded** — Chad isn't playing
and the $20 is collected on site.

**Still blank, both waiting on Nick:** Sunday Threetops pairings (picked on
arrival; renders as an information card, not "TBD") and Tuesday PM's tee time
(renders "Time TBD", no countdown).

---

## 5. What's built

**Identity**
- Name picker on first launch, 24 names sorted by last name, no default, confirm
  card before committing. Stored in `msmi-who`.
- "Change golfer" switches anytime. Betting stored **per person** under
  `msmi-bets:<UPPER FULL NAME>` so switching never clobbers anyone.
- **Tee choice is per player**, stored as an index under
  `msmi-tee:<UPPER FULL NAME>`, clamped to each course's tee count. Every player
  row renders at that player's own tee and names it — a four-player group can
  hold four different tees at once.

**Palettes — dark only, three skins**
```
TEAL (default)   bg #11302B  card #173B35  raise #1F4640  accent #D9B665
                 ink #DEEAE2 mute #A4C1AD  good #6FC49A warn #E0B65C hot #DE8A6E
CHARCOAL         bg #232327  card #2D2D32  raise #38383E  accent #4ADE80
                 ink #FFFFFF mute #A8A8AF  good #4ADE80 warn #FFD84D hot #FF6B5A
EPICMINDS        bg #0E2833  card #12303D  raise #1C3C4B  accent #C9A24B
  (Chad only)    ink #E9F1F3 mute #A6C6D1  good #6FB39F warn #C9A24B hot #D98A6E
```
Skin resolves to EpicMinds for Chad Schurecht (no toggle shown), otherwise
`msmi-skin` ("teal" | "char"), default teal. Toggle is a 56×30 two-colour pill in
the hero's top-right, no text, hidden for Chad, absent from the picker.

Type: Newsreader serif display for teal and EpicMinds; Hanken Grotesk 800 for
charcoal; Hanken Grotesk body throughout.

**Design language** — borrowed from the Arccos golf app. Three reusable elements:
player row (name + big value + coloured progress bar), stat tile (four across,
value + label + coloured underline), segmented control (the tee selector). All
share `ramp(f)` — green under .45, amber under .75, red above. Colour carries
meaning; this deliberately replaced the old one-accent-per-screen rule.

**Screens** — Trip (hero + round cards), Schedule, Money, Handicaps, Hotel, plus
the picker and the scorecard sheet.
- Hero: name in `var(--accent)`, "Change golfer", four tiles — Rounds / Index /
  Buy-in / Net (Net is live from the betting tracker)
- Round card: player rows, segmented tees, four tiles (Strokes / Yards / Slope /
  Rating), Scorecard + Directions
- Scorecard: **one row per hole**, five columns, front and back nine with Out/In
  summaries. Shots render as coloured badges — amber for one stroke, red for two.
  Nothing in the app scrolls horizontally except the Handicaps tables.
- Rounds a player isn't in are dimmed in place, never hidden

**Also:** maps provider preference (`msmi-maps`, Google default), `noindex` +
`robots.txt`, epicminds lockup footer on every page, install page with separate
iPhone paths for the newer three-dot share menu and the older share icon.

**localStorage keys — never clear these once the trip starts:**
`msmi-who`, `msmi-bets:<NAME>`, `msmi-tee:<NAME>`, `msmi-skin`, `msmi-group`,
`msmi-maps`

---

## 6. What's next

**1. Nick is emailing revised pairings spreadsheets.** He's changing some pairings
again. When they arrive: **diff the new sheet against what's live before writing
any update prompt.** Last time that diff caught a changed game format, two moved
handicaps, a changed tee time and a dropped player — none of which he mentioned in
his email. Parse both sheets with openpyxl and compare programmatically.

**2. Chad has more changes of his own.** Batch them with the pairings update so
it's one Claude Code run.

**3. Nick sends to the group Friday.** Anything to ship should land before then.

**Lower priority, still open:**
- Fix the `deploy` footgun so it pushes the repo instead of copying from Downloads
- Add an update-check bar — the SW should check for a new version on launch and
  offer "new version — tap to reload". Matters the first time Chad pushes a fix
  from Gaylord.
- Record `Brand/02_Logos/` as the only sanctioned logo source in the brand skill

---

## 7. First thing in the new chat

1. `cd ~/code/msmi-2026 && git status` — confirm clean and pushed
2. Ask whether Nick's revised spreadsheet has arrived
3. Collect Chad's own change list
4. Diff, then write **one** prompt covering everything
