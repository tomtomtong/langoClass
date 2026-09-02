# Kahoot! Design Reference

A design-system-style overview of Kahoot!’s visual identity, product UX, and game experience patterns. Intended as a reference for building classroom quiz products (e.g. LangoClass).

**Sources:** [Kahoot! Brand Guidelines (PDF)](https://kahoot.com/library/kahoot-logo/), [Kahoot! Help Center](https://support.kahoot.com/), [Jimmy Cunnane case study](https://www.jimmyalphachannels.com/kahoot)

---

## 1. Design Philosophy

### Loud Learning

Kahoot!’s core design thesis is **“Loud Learning”** — learning should feel energetic, social, and playful rather than quiet or passive. The product is not a quiz app dressed as education; it is a **game** that happens to teach.

| Principle | What it means in practice |
|-----------|---------------------------|
| **Play first** | Mechanics, pacing, and feedback mirror arcade games — timers, streaks, leaderboards, confetti |
| **Shapes as language** | Circles, triangles, diamonds, and squares are literal building blocks across brand, UI, and gameplay |
| **Dual attention** | Host screen (projected) and player screen (phone) are designed as complementary views, not duplicates |
| **Celebration by default** | Correct answers, streaks, podium finishes, and even errors stay positive and humorous |
| **Inclusive competition** | Everyone participates; rankings are shown carefully so lower performers aren’t publicly humiliated |

### Brand Values

These values drive both marketing and product design:

- **Playful** — Play is the first language; fun makes learning engaging for everyone
- **Curious** — Discovery and exploration are celebrated
- **Inclusive** — No learner should be left out; team modes, nickname generators, and accessibility options reinforce this

---

## 2. Visual Identity

### Atmosphere

Quirky, colorful, expressive, and energetic. Flat illustration with occasional hard-edged shadows. Never neutral or corporate-gray as a base — color is identity.

### Color Palette (Brand)

Kahoot! purple is the default brand color. The full palette is intentionally loud; official guidelines recommend **2–3 colors per composition** to avoid chaos.

| Role | Hex | Notes |
|------|-----|-------|
| **Kahoot Purple (default)** | `#46178F` | Primary brand color; use when a single color must represent Kahoot! |
| **Deep Purple** | `#25076B` | Darker accent |
| **Violet** | `#864CBF` | Mid purple |
| **Light Violet** | `#C2A5DF` | Soft purple |
| **Orange** | `#F5A23D` | Warm accent |
| **Light Orange** | `#FAD09E` | Soft warm |
| **Red** | `#C60929` | Strong accent |
| **Light Red** | `#FF99AA` | Soft red |
| **Amber** | `#FFA602` | Highlight |
| **Yellow** | `#FFDD33` | Bright highlight |
| **Gold** | `#FFC00A` | Warm yellow |
| **Blue** | `#1368CE` | Primary blue |
| **Deep Blue** | `#0542B9` | Dark blue |
| **Sky Blue** | `#45A3E5` | Light blue |
| **Pale Blue** | `#A2D1F2` | Soft blue |
| **Teal** | `#028282` | Cool accent |
| **Cyan** | `#33CCCC` | Bright teal |
| **Pale Cyan** | `#99E5E5` | Soft teal |
| **Green** | `#26890C` | Success / nature |
| **Bright Green** | `#66BF39` | Vivid green |
| **Pale Green** | `#B2DF9C` | Soft green |
| **Text Dark** | `#333333` | Default body text on light backgrounds |
| **Surface Light** | `#F2F2F2` | Light gray backgrounds |

**Color rules (brand):**

- Colored or photographic backgrounds → **white text only**. Never colored text on colored backgrounds
- Adhere to **WCAG 2.1** contrast requirements
- Limit to 2–3 palette colors per layout

### Color Palette (Game — Answer System)

The four answer options are a **fixed, iconic mapping** that players learn by muscle memory. These colors are **not customizable** in standard play — they are part of the game grammar.

| Index | Shape | Color | Player UI |
|-------|-------|-------|-----------|
| 0 | Triangle | Red | Large tap target on player device |
| 1 | Diamond | Blue | Large tap target on player device |
| 2 | Circle | Yellow | Large tap target on player device |
| 3 | Square | Green | Large tap target on player device |

On the **host screen**, answer options appear as labeled text with matching shape/color icons. On the **player screen**, only the four colored shape buttons are shown — players must map host labels to their device.

This dual-screen design is intentional: it forces active engagement and prevents players from simply reading answers off the projected screen.

### Typography

| Property | Value |
|----------|-------|
| **Family** | Montserrat |
| **Weights** | Light, Regular, Bold, Black (four weights only) |
| **Default text** | `#333333` on light backgrounds; white on dark/colored backgrounds |
| **Titles / shouting** | Montserrat Black |
| **Headers / subtitles** | Montserrat Bold |
| **Body** | Montserrat Regular |
| **Long-form / airy docs** | Montserrat Light with extra line spacing |

A pop of brand color on keywords in Montserrat Black is acceptable for emphasis.

### Shapes as Visual Language

Simple geometric primitives are not decoration — they are the brand’s structural vocabulary:

- Circles, triangles, diamonds, and squares appear in illustrations, backgrounds, whitespace accents, and gameplay
- Shapes can be combined and manipulated for campaigns, merchandise, and UI chrome
- Jimmy Cunnane’s brand work explicitly treated shapes as **literal building blocks** for Kahoot!’s visual system (“Loud Learning”)

**Illustration rules:**

- Flat lighting; hard-edged shadows only when form is needed
- Positive or humorous tone — even error states
- Center illustrations around a limited color set per composition
- No strokes, textures, or off-palette colors on illustrations
- No neutral/gray bases — illustrations should be colorful

### Logo

Two marks:

1. **Full wordmark** — Primary logo for external communications and brand representation
2. **Icon** — Compact mark when brand is already established; acceptable inside illustrations but not as standalone comms logo

**Logo rules:**

- Never modify, recolor, rotate, or add effects (shadows, etc.)
- Purple or black logo on white/light gray; white logo on colored backgrounds
- Minimum clear space: half the logo height
- Never place on insufficient-contrast backgrounds

---

## 3. Tone of Voice

| Do | Don’t |
|----|-------|
| Informal, casual | Formal |
| Friendly | Patronizing |
| Playful, fun | Childish |
| Inclusive | Distant |
| Curious | Complex |

Voice adapts to context: **inspiring** when users explore, **helpful** when they need answers, **enthusiastic** when they succeed.

---

## 4. Product UX Architecture

### Dual-Screen Model

```
┌─────────────────────┐     ┌─────────────────────┐
│   HOST (projected)  │     │  PLAYER (phone)     │
├─────────────────────┤     ├─────────────────────┤
│ Game PIN            │     │ Enter PIN + nickname│
│ Question text       │     │ (no question text)  │
│ Answer labels +     │     │ 4 shape buttons only│
│   shape icons       │     │                     │
│ Timer bar           │     │ Tap matching shape  │
│ Results bar chart   │     │ Personal score /    │
│ Leaderboard         │     │   rank feedback     │
│ Podium              │     │ Medal if top 5      │
└─────────────────────┘     └─────────────────────┘
```

The host drives pacing and social energy. Players stay heads-down on their devices, reducing cheating and increasing participation.

### Game Flow (Live Classic)

```
Lobby → Question (think phase) → Question + answers + timer
    → Waiting (all answered or time out)
    → Results (correct answer highlighted, bar chart)
    → [Optional: re-show image]
    → Leaderboard (top 5, ~5 sec)
    → … repeat …
    → Final Podium (confetti, medals, scores)
```

**Lobby**

- Displays game PIN; players join with nickname
- Optional lobby video or lobby music
- Host can kick players before start
- Settings gear for live game options
- Auto-start after 15 seconds if at least one player joined

**Question sequence**

1. Question text appears first (5-second “think” phase) — encourages recall before options show
2. Image/video and answer options appear; timer and music start
3. Players answer on device; host sees live response count

**Results**

- Correct answer gets checkmark; incorrect options fade
- Bar chart shows class-wide answer distribution
- Host can re-show embedded image for discussion

**Leaderboard**

- Top 5 shown on host screen (~5 seconds)
- Celebratory messages for streaks and big rank jumps
- Players outside top 5 see personal score without exact rank

**Podium**

- Confetti animation on host and top players
- Top 5 see ranking + medal icon on their device
- Below 5th: score only, no position number (reduces public embarrassment)
- “Find New Game” / playlist “Next” options

### Game Modes

| Mode | Design note |
|------|-------------|
| **Classic** | Individual competition; default experience |
| **Team** | Shared devices; team colors and team talk |
| **Playlist** | Sequential kahoots with podium → Next flow |

---

## 5. Core UI Patterns

### Player Answer Buttons

The most important UI element on the player side:

- **Full-width or near-full-width colored regions** — not small radio buttons
- **Shape icon** centered in each color block
- **No answer text** on player screen — mapping is the game
- **Immediate tap feedback** — selection state before “waiting for others”
- Fixed order: Red (top/left), Blue, Yellow, Green — consistent across every question

### Host Question Screen

- Large question typography (Montserrat Black/Bold)
- Optional media (image/video) with generous sizing
- Four answer tiles with shape + color + text label
- Prominent countdown timer (often circular or bar)
- Player count / “answered” indicator

### Feedback & Motion

- **Correct answer:** green check, option highlight, positive sound
- **Incorrect:** fade non-correct options; player sees personal result
- **Streaks:** on-screen celebration messages
- **Podium:** confetti, medal icons, rank numbers for top 5
- **Transitions:** automatic between phases (~5 sec on results/leaderboard) unless host pauses

### Sound Design

Sound is a core design layer, not an afterthought:

- Lobby music (customizable in premium tiers)
- Question start music when timer begins
- Tick / urgency as timer runs low
- Correct/incorrect feedback sounds
- Leaderboard and podium celebration audio
- Host can mute/adjust lobby music volume

### Avatars & Characters

- Customizable profile avatars with unlockable characters and accessories
- Game characters available as live game setting
- Personalization reinforces repeat play and social identity in classroom settings

### Onboarding (Dogfooding)

Kahoot! teaches its own mechanics through a **mini-quiz onboarding** — timed answers, shape buttons, and reinforcement screens during first-time setup. The product demonstrates itself instead of explaining with static tutorials.

---

## 6. Theming & Customization

| Tier | Capabilities |
|------|--------------|
| **Standard** | Company logo + 4 standard backgrounds |
| **Custom** | Logo upload, patterned/colored backgrounds, custom background image (3840×2560), background color picker, contrast/accent colors |
| **Immersive** | 112 custom fonts (incl. Hind, League Spartan), curated color palettes, custom lobby music |

**Increase contrast** (Accessibility): optional mode that boosts color contrast on question screens with before/after preview; targets WCAG readability.

Game answer colors (red/blue/yellow/green shapes) remain fixed even with custom theming — they are gameplay constants.

---

## 7. Accessibility

- WCAG 2.1 contrast enforced in brand guidelines
- **Increase contrast** toggle for live games
- **Nickname generator** — auto-generated names for anonymity
- **2-Step Join** — tile pattern verification (changes every 7 seconds) for secure joining
- **Unlimited time** option for questions
- Keyboard shortcuts (community extensions mapped O/P/S/D to shapes — platform-native support varies)

---

## 8. Host Controls & Settings

Accessible via gear icon in lobby and during play:

| Setting | Purpose |
|---------|---------|
| Show questions & answers | Control information reveal |
| Randomize question order | Reduce predictability |
| Randomize answer order | Reduce pattern memorization |
| Autoplay | Auto-advance (~5 sec on results/leaderboard) |
| Nickname generator | Privacy / fun names |
| 2-Step Join | Join security |
| Lock joining | Close lobby |
| Reactions | Player emoji reactions |
| Team selection | Team mode setup |
| Full screen | Hide browser chrome on host display |
| End kahoot | Jump to podium early |

---

## 9. Design Principles for Builders

Lessons distilled from Kahoot!’s design system for similar edtech products:

1. **Separate host and player UIs** — Don’t mirror the same screen; design complementary views
2. **Encode gameplay in color + shape** — Fixed mappings become learnable affordances
3. **Think phase before reveal** — Brief delay before options reduces passive reading
4. **Celebrate without humiliating** — Show top 5 ranks publicly; show score-only for others
5. **Sound + motion = engagement** — Timer audio and confetti are features, not polish
6. **Limit palette per screen** — Brand is colorful, but each screen uses 2–3 colors max
7. **Shapes over stock illustration** — Geometric primitives scale from favicon to stadium projection
8. **Positive error states** — Humor and encouragement even when users fail
9. **Auto-pacing with host override** — Default rhythm keeps energy; host can pause for teaching moments
10. **Dogfood your mechanics** — Onboarding should feel like playing the product

---

## 10. Quick Reference

### Brand

```
Primary:     #46178F  (Kahoot Purple)
Text:        #333333  (light bg) / #FFFFFF (dark bg)
Typeface:    Montserrat — Light, Regular, Bold, Black
Shapes:      circle, triangle, diamond, square
```

### Gameplay

```
Answer 0:  Red Triangle
Answer 1:  Blue Diamond
Answer 2:  Yellow Circle
Answer 3:  Green Square

Host:      question + labeled answers + charts + leaderboard
Player:    shape buttons only (no answer text)
Podium:    top 5 ranked + medals; others see score only
```

---

*This document summarizes publicly available Kahoot! brand and product patterns. For official assets, see [Kahoot! brand guidelines](https://kahoot.com/library/kahoot-logo/).*
