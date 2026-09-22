---
version: 1.0
name: Lango 3.0 design system
description: UI style analysis from Lango3.0 (Expo mobile app) for LangoClass web/CMS alignment.
sources:
  - Lango3.0/src/theme/tokens.ts
  - Lango3.0/DESIGN.md
  - Lango3.0/PRODUCT.md
  - Lango3.0/design-demos/direction-approved.md
  - Lango3.0/src/screens/SchoolHomeScreen.tsx
approved_direction: Course-first hybrid (Course Coach + Uncle Tommy hero)
---

# Lango 3.0 Design System

Design reference extracted from **Lango3.0.zip** (Expo React Native app). Use this when updating LangoClass CMS, host, join, or marketing surfaces so they feel like the same product family as the student mobile app.

---

## 1. Design philosophy

Lango is a **mobile-first school learning app**: short actions, one clear next step, warm surfaces, and Uncle Tommy as the friendly coach character.

| Principle | Meaning |
|-----------|---------|
| **Obvious next action** | Each screen has one primary CTA (purple gradient pill). Secondary actions use ghost/outline pills. |
| **Approachable, not corporate** | Mist-blue canvas, cream cards, large radii, Nunito black headlines — playful but readable for students. |
| **Honest states** | Loading, empty, and error states are always visible with one recovery action. |
| **Character-led** | Uncle Tommy appears in hero cards and daily warm-ups; mascots/Buddies use CMS art without a second visual system. |
| **Restrained motion** | Press scale, short fades, progress ticks — no continuous background animation or heavy blur/glow hierarchy. |

**Approved product direction** (Sept 2026): keep the **Course Coach** language — in-progress course as a coach card with Uncle Tommy, course exploration as a **two-column thumbnail grid**, bottom tab navigation (Today / Learn / Buddy / Profile).

---

## 2. Color system

Production tokens live in `src/theme/tokens.ts`. Prefer **semantic roles** in UI code, not raw hex literals.

### 2.1 Canvas & surfaces

| Token | Hex | Role |
|-------|-----|------|
| `page` | `#EAF1FF` | Main app background (mist blue) |
| `pageDeep` | `#DDE9FF` | Deeper sky band, gradients |
| `cream` / `surface` | `#FFFDF8` | Card and sheet background (warm white) |
| `white` | `#FFFFFF` | Inputs, secondary buttons, tab bar |

### 2.2 Brand & actions

| Token | Hex | Role |
|-------|-----|------|
| `coral` / `primary` | `#A1268E` | Primary actions, progress fill |
| `coralDeep` / `magenta` | `#743C9B` | Gradient end, deep accent |
| `coralSoft` | `#FBE1EB` | Soft progress track, tinted panels |

Primary button: **horizontal gradient** `#A1268E → #743C9B` (`GradientPillButton`).

### 2.3 Learning & feedback semantics

| Token | Hex | Role |
|-------|-----|------|
| `teal` | `#007F78` | Correct answers, learning panels, coach cards |
| `tealSoft` | `#D8F7F2` | Teal tinted backgrounds |
| `selection` | `#2D73B5` | Unsubmitted / selected quiz choice |
| `selectionSoft` | `#DCEFFF` | Selection chips, class-average pill |
| `error` | `#B92D4F` | Incorrect answers, destructive emphasis |
| `errorSoft` | `#FDE5EC` | Error backgrounds |

**Rule:** Teal = correct · Blue = selected · Red = wrong · Purple = primary CTA · Yellow = rewards/XP.

### 2.4 Accent palette (supporting only)

| Token | Hex | Use |
|-------|-----|-----|
| `mustard` / `gold` | `#F9B545` | XP, rewards, warm CTAs on dark cards |
| `sky` | `#54ADF4` | Highlights, class-average marker |
| `pink` | `#F577A5` | Decorative accents |
| `lavender` | `#C294FF` | Adventure sky gradient stops |
| `doodle` | `rgba(84,173,244,0.3)` | Background SVG strokes |

### 2.5 Text & lines

| Token | Hex | Role |
|-------|-----|------|
| `ink` | `#344356` | Headlines, body |
| `muted` | `#526579` | Secondary copy, metadata |
| `line` | `#C8D5E6` | Borders, dividers |

### 2.6 CSS custom properties (web)

```css
:root {
  --lango-page: #eaf1ff;
  --lango-page-deep: #dde9ff;
  --lango-surface: #fffdf8;
  --lango-primary: #a1268e;
  --lango-primary-deep: #743c9b;
  --lango-primary-soft: #fbe1eb;
  --lango-teal: #007f78;
  --lango-teal-soft: #d8f7f2;
  --lango-selection: #2d73b5;
  --lango-selection-soft: #dcefff;
  --lango-gold: #f9b545;
  --lango-sky: #54adf4;
  --lango-ink: #344356;
  --lango-muted: #526579;
  --lango-line: #c8d5e6;
  --lango-error: #b92d4f;
  --lango-radius-card: 32px;
  --lango-radius-sheet: 40px;
  --lango-radius-pill: 999px;
  --lango-space-page: 24px;
  --lango-space-card: 22px;
  --lango-space-stack: 14px;
  --lango-font: "Nunito", ui-rounded, system-ui, sans-serif;
}
```

---

## 3. Typography

**Family:** Nunito (Google Fonts) — weights 400, 600, 800, 900.

| Role | Weight | Size | Line height | Usage |
|------|--------|------|-------------|--------|
| **Headline** | 900 Black | 32px (hero scales down) | ~1.08–1.18 | Page heroes, mission titles |
| **Title** | 900 Black | 19–24px | tight | Section headers, card titles |
| **Body** | 600 SemiBold | 14px | 20px | Descriptions, hints |
| **Label** | 800 ExtraBold | 12–17px | — | Buttons, pills, tab labels, XP |

**Web stack:** `'Nunito', ui-rounded, system-ui, sans-serif`

**Rules:**
- Use **black (900)** for titles only; body stays semibold.
- Keep hero copy short (2–3 lines max on phone).
- Negative letter-spacing on large headlines (`-0.4px` to `-1.6px` in demos).
- Button labels: extra-bold, white on primary, coral on ghost.

---

## 4. Spacing & layout

From `tokens.space` and `layout.ts`:

| Token | Value | Use |
|-------|-------|-----|
| `page` | 24px | Screen horizontal inset (phone) |
| `card` | 22px | Inner card padding |
| `stack` | 14px | Vertical gap between stacked blocks |

**Breakpoints**

| Size | Min width | Page padding | Content max (home) |
|------|-----------|--------------|-------------------|
| Phone | — | 24px | 472px |
| Tablet | 768px | 40px | 900px |
| Large tablet | 1024px | 48px | 1140px |

**Grids**
- Course exploration: **2 columns** on phone, 2–3 on tablet (`courseColumns`).
- Course thumb height: 120px phone → 204px large tablet.
- Bottom tab bar: reserve safe area (`env(safe-area-inset-bottom)`).

---

## 5. Shape language

| Token | Radius | Use |
|-------|--------|-----|
| `card` | **32px** | Main cards, coach hero, streak cards |
| `sheet` | **40px** | Modals, bottom sheets |
| `pill` | **999px** | All buttons, filters, XP chips, progress tracks |

Nested elements inside cards: **16–20px** (course tiles, filter chips, tab items).

**Avatars:** rounded squares ~14–18px radius (not circles for school identity chip).

---

## 6. Elevation & depth

Warm-white cards on mist-blue page — **no glassmorphism as hierarchy**.

| Level | Shadow | Use |
|-------|--------|-----|
| **Card** | `0 10px 20px rgba(52,67,86,0.14)` | Home cards, course tiles |
| **White button** | `0 5px 10px rgba(52,67,86,0.16)` | Ghost pills on blue canvas |

**Background decoration:** `PastelBackdrop` — faint cloud ellipses + wavy doodle strokes (sky/teal/mustard at low opacity). Optional `AdventureSkyBackdrop` gradient: `#DDE9FF → #DCEFFF → #D8F7F2 → #C294FF`.

Do **not** use large blurs, neon glows, or dark-mode glass cards for primary hierarchy.

---

## 7. Motion

From `motion.ts` / `motionTokens.ts`:

| Interaction | Duration | Notes |
|-------------|----------|-------|
| Press feedback | scale **0.97** | `PressableScale` on all tappable controls |
| Fade / crossfade | 200ms | Screen and content swaps |
| Enter / stagger | 260ms / 55ms stagger | List and card entrance |
| Answer feedback | 700ms budget | Must not block Continue |
| Progress bar tick | 280ms | Course/exercise progress |
| Celebrate | 240ms enter, 1600ms hold | Lesson complete only |

**Easing:** `cubic-bezier(0.23, 1, 0.32, 1)` (ease-out) for UI; respect **reduced motion** — disable Lottie loops and nonessential animation.

---

## 8. Core components

### 8.1 Buttons

| Component | Style |
|-----------|--------|
| **GradientPillButton** | Full-width, min-height 56px, purple gradient, white extra-bold label |
| **GhostPillButton** | White fill, 2px coral border, coral text, white-button shadow |
| **Filter chip** | Pill, inactive = translucent white; active = ink background + white text |
| **Gold CTA on dark** | `#F9B545` pill on plum/teal coach cards (secondary emphasis) |

### 8.2 Cards

| Pattern | Description |
|---------|-------------|
| **Coach hero** | Teal (or dark plum) rounded card, white type, gold CTA, Uncle Tommy image overlapping bottom-right |
| **Tommy Daily** | Soft mint/teal strip, small Tommy thumb, one phrase warm-up |
| **Course tile** | White card, 18–20px radius, full-width image thumb, title + metadata |
| **Mission / assignment** | Dark ink/plum card with decorative circle, gold start button |

### 8.3 Progress

| Component | Style |
|-----------|--------|
| **CourseProgressBar** | 6px coral fill on coralSoft track; sky dot for class average; optional sky pill label |
| **Streak / XP** | Gold numerals, compact pills |

### 8.4 Navigation

| Element | Style |
|---------|--------|
| **Bottom tab bar** | White 96% opacity, top border, 4 tabs, dot indicator above label, active = tinted background (lavender/mist) + brand color text |
| **Search bar** | White, ~52px height, 18px radius, soft shadow |

### 8.5 Character & Buddies

- **Uncle Tommy:** aspect-ratio preserved, drop-shadow, overlaps hero (never blocks CTA).
- **CMS Buddies:** same token system; list rows + full-screen practice; explicit loading/error/empty.

---

## 9. Screen patterns (School Home)

### Today tab
- Hero headline + Uncle Tommy (`LessonHeroBackdrop` / pastel sky).
- “Continue learning” coach card for resume course.
- Tommy Daily phrase strip.
- Class highlights, streak, notices ticker.

### Learn tab
- Search + language filters.
- Two-column **Explore courses** grid with banner thumbnails.
- Progress badges on assigned courses.

### Buddy tab
- CMS-driven catalog list → full-screen Buddy practice scene.

### Profile tab
- XP level, words, achievements — same card rhythm.

---

## 10. Mapping to LangoClass (web/CMS)

Current LangoClass CMS uses purple `#673987` / Nunito — **close but not identical** to Lango 3.0 tokens.

| LangoClass today | Lango 3.0 target |
|------------------|------------------|
| `--purple: #673987` | `--lango-primary: #a1268e` |
| `--wash` backgrounds | `--lango-page: #eaf1ff` page canvas |
| `.paper` white cards | `--lango-surface: #fffdf8` cream cards |
| Pill buttons (solid purple) | Gradient primary `#a1268e → #743c9b` |
| 14px card radius | **32px** card radius for mobile parity |
| Host/join screens | Keep exercise semantics: teal correct, blue selected, red wrong |

**Recommended alignment steps**
1. Import Nunito 400/600/800/900 on all public HTML shells.
2. Replace CMS `--purple` with Lango 3.0 primary gradient for primary CTAs only.
3. Set CMS page background to `#EAF1FF`, cards to `#FFFDF8`.
4. Increase card `border-radius` on home/dashboard cards toward 24–32px.
5. Use semantic colors for quiz/host (already partially aligned).
6. Reuse Uncle Tommy assets from shared `/assets/uncle-tommy/` paths.

---

## 11. Design demos vs production

The zip includes three HTML prototypes (`design-demos/`). They explored alternate palettes (pink/teal, paper/sky, plum/lilac). **Production code follows `tokens.ts`**, not the demo CSS variables.

| Demo | Status |
|------|--------|
| `01-course-coach.html` | **Approved direction** — coach card + course grid |
| `02-learning-journey.html` | Reference only — path/step metaphor |
| `03-school-pulse.html` | Reference only — class pulse dashboard |

When in doubt, trust **`src/theme/tokens.ts`** and **`DESIGN.md`** inside Lango3.0 over demo HTML colors.

---

## 12. Do's and don'ts

### Do
- One purple primary action per view.
- Show loading / empty / error for every remote catalog (courses, Buddies, CMS assets).
- Label every Buddy choice and retry for screen readers.
- Use `PressableScale` (or web `:active` scale) on interactive elements.
- Keep copy short and action-oriented.

### Don't
- Don't introduce a second visual system for CMS Buddy content.
- Don't animate large backgrounds or avatars continuously.
- Don't use accent yellow/sky/lavender for primary navigation actions.
- Don't rely on blur/glow for card hierarchy.
- Don't mix demo prototype colors with production tokens in the same screen.

---

## 13. Quick reference — exercise UI semantics

Aligned with host/join and mobile quiz feedback:

| State | Color | Example |
|-------|-------|---------|
| Default option | White card, line border | MCQ choice |
| Selected | `#2D73B5` / `#DCEFFF` | Before submit |
| Correct | `#007F78` / `#D8F7F2` | After grading |
| Incorrect | `#B92D4F` / `#FDE5EC` | After grading |
| Reward / XP | `#F9B545` | Points burst |

---

*Generated from analysis of `/Users/bco_o/Downloads/Lango3.0.zip` — production token source: `Lango3.0/src/theme/tokens.ts`.*
