# News Homepage Design — usdatacenterprojects.com

**Date:** 2026-04-12  
**File:** `homepage.html`  
**Status:** Approved

---

## Goal

Build a news-first homepage (`homepage.html`) that serves as the primary entry point for `www.usdatacenterprojects.com`. Covers US data center project news across all 50 states with editorial, curated external, and project update content types.

---

## Layout

Bloomberg/FT compact dense — two-column, text-forward, data-rich.

```
┌─────────────────────────────────────────────────────┐
│  HEADER: Logo | News · Projects · About | Search    │
├─────────────────────────────────────────────────────┤
│  REGION TABS: ALL · NORTHEAST · SOUTH · MIDWEST · WEST │
│  STATE PILLS: Virginia · Texas · Arizona · Ohio …   │
├──────────────────────────────────┬──────────────────┤
│  MAIN FEED (65%)                 │  SIDEBAR (35%)   │
│  • Top Story banner              │  • Live Projects │
│  • News rows (mixed types)       │  • By the Numbers│
│  • Load more                     │  • Top States    │
├──────────────────────────────────┴──────────────────┤
│  FOOTER: About · States A–Z · Newsletter signup     │
└─────────────────────────────────────────────────────┘
```

---

## Components

### Header
- Logo SVG (reused from `index.html`) + "US Data Center Projects" wordmark
- Nav: News · Projects · About + search icon
- `3px` red bottom border — only red element in header

### State Navigation Bar (sticky below header)
- **Region tabs:** ALL · NORTHEAST · SOUTH · MIDWEST · WEST
- Active tab: underlined red
- Selecting region reveals state pills for that region
- Active state pill: filled red (`#DC2626`)
- Region → state mapping:
  - Northeast: VA, NY, NJ, PA, MA, CT, MD, DE, NH, VT, ME, RI
  - South: TX, GA, FL, NC, SC, TN, AL, MS, LA, AR, OK, KY, WV
  - Midwest: OH, IL, IA, IN, MI, MN, MO, NE, ND, SD, KS, WI
  - West: AZ, CA, NV, WA, OR, CO, UT, ID, MT, WY, NM, AK, HI

### Main Feed (65% width)
- **Top Story banner:** larger headline, `TOP STORY` red label, source + state + read time
- **News rows:** border-bottom separated, each containing:
  - Content type badge: `EDITORIAL` (dark fill) · `CURATED` (gray fill) · `PROJECT UPDATE` (red outline)
  - Headline (font-weight 800, #111827)
  - Source · State · Time ago (muted gray)
- 15 rows visible, "Load more" button at bottom

### Sidebar (35% width)
- **LIVE PROJECTS** — 5 most recent tracker entries: Company · State · status pill (Planning / Permitting / Construction / Complete)
- **BY THE NUMBERS** — 3 stats: total projects tracked, states covered, last updated
- **TOP STATES THIS WEEK** — top 5 states by new activity with relative bar indicators

### Footer
- 3 columns: About | States A–Z grid | Newsletter email signup
- Copyright line

---

## Visual Style

### Color System
| Token | Value | Usage |
|---|---|---|
| Background | `#FFFFFF` | Page background |
| Row hover | `#F9FAFB` | News row hover state |
| Border | `#F3F4F6` | Row separators |
| Accent | `#DC2626` | Breaking labels, active state/tab, badge outlines |
| Text primary | `#111827` | Headlines |
| Text meta | `#6B7280` | Source, state, byline |
| Text timestamp | `#9CA3AF` | Time ago |

### Typography
- Font: Inter (Google Fonts, already loaded)
- Section labels: `font-weight: 700`, uppercase, `letter-spacing: 1px`
- Headlines: `font-weight: 800`
- No new font dependencies

### Content Type Badges
- `EDITORIAL` — `bg-gray-900 text-white`
- `CURATED` — `bg-gray-100 text-gray-700`
- `PROJECT UPDATE` — `border border-red-600 text-red-600`

---

## Tech Stack
- **Tailwind CSS** via CDN (no build step)
- **Phosphor Icons** via CDN (matches `index.html`)
- **Inter** via Google Fonts (matches `index.html`)
- Pure HTML + minimal vanilla JS for tab/pill interaction only

---

## Responsive
- `< 768px`: sidebar collapses below main feed; region tabs scroll horizontally
- No other breakpoints required for this scope

---

## Out of Scope
- Real data/API integration (static placeholder content only)
- Dark mode (not planned for news homepage)
- Search functionality (icon only, non-functional)
- Article detail pages
