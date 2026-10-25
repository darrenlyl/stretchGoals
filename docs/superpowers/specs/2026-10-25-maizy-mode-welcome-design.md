# Maizy mode and a new welcome screen

## Intent
The welcome screen ("Meet Maizy…") looks AI-generated: everything in identical rounded cards, numbered
circles, a tinted privacy box, and a cool clinical palette that clashes with Maizy's warm storybook art.
Make the welcome screen Maizy-led, and add a **Maizy** theme whose palette comes from her art and
recolours the whole app.

## Goals
- Welcome screen rebuilt as layout **A (Stage)**, in every theme (System, Light, Dark, Maizy):
  Maizy large on the right standing on a soft floor with a sun disc behind her; on the left one short
  headline, one sentence, **Start camera**, and the privacy promise as one quiet line. No cards, no
  numbered steps, no tinted box. Brand name small at top left.
- New theme **Maizy** in Settings → Appearance (System | Light | Dark | Maizy), saved like the others.
  Recolours every screen through the existing token block only.
- Maizy palette (from her art): blush paper background (~#FBF2F4), plum-brown ink (~#3A2630) and muted
  (~#7A6470), plum primary button (~#6B4A8C, white text), butter sun (~#F5D98E), blush floor (~#F4C7D0),
  lavender accents (~#B7A3DC). Warn and danger retuned to sit with these while staying clearly amber/red.
  Maizy theme uses the system rounded face (`ui-rounded`, SF Pro Rounded; falls back to the system font).

## Non-goals
- No layout changes to dashboard, calibrate, stretches or settings (colours only, via tokens).
- No new font files or dependencies. No dark variant of Maizy mode.
- Default theme stays System.

## Anti-goals
- Must not look like another template: no eyebrow labels, no gradient washes, no cards on the welcome.
- Text must keep WCAG AA contrast in every theme; Start camera stays the obvious action.
- The camera-permission error and note must still show on the welcome screen.

## Constraints
- `src/ui/index.js` + `src/ui/ui.css` only (Darren's UI module). Maizy is mounted by app.js into the
  existing `#maizy` slot, which must not be moved or re-created (it carries her live animation).
- Window minimum 900×640; the welcome must fit without scrolling there and stack at the ≤720px rule.
- Reduced motion respected; Maizy's own animations are her module's business.
- Maizy's sprite already has no background, so it sits on the floor/sun shapes directly.

## Approaches
1. **Chosen:** a third colour token block `.sg-app[data-theme="maizy"]` + welcome rebuilt as layout A
   for all themes. Least code, can't drift because every screen already reads the tokens.
2. Layout A only in Maizy mode: two welcome layouts to maintain, keeps the look the user called AI-made.
3. Separate Maizy stylesheet overriding whole screens: duplicates rules, fights the token structure.

## Decided
- Layout A in all themes; Maizy theme recolours the whole app; theme list gains "Maizy".
- Copy (my proposal, user saw it in the mockup): "Sit like Maizy." / "She copies how you sit. Slouch and
  she slouches. Sit tall and she cheers." / Start camera / "Video never leaves this laptop. Your computer
  may ask for permission to use the camera."

## My calls (check these)
- Top-bar sun/moon button keeps toggling light ↔ dark; from Maizy it goes to dark.
- `html[data-sg-theme="maizy"]` page background matches the blush paper.
- In Light/Dark the floor and sun use the existing vital-soft / warn-soft tokens (via new
  `--sg-floor` / `--sg-sun` tokens set per theme), so layout A looks native in each.

## Left to the builder
- Exact sizes and spacing, sun/floor proportions at 900×640 and larger, final token values after a
  contrast check, theme icon for Maizy (a small heart or flower drawn in the existing icon style).
