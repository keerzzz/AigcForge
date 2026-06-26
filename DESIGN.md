# AigcForge Design Protocol

This protocol applies to product UI work in `packages/app/`, shared components in `packages/ui/`, desktop shell surfaces in `packages/desktop/`, and terminal-facing UX in `packages/tui/`.

## Product Character

AigcForge is a developer tool. Prefer quiet, dense, operational interfaces over marketing-style pages. Optimize for repeated use, scanning, comparison, and fast recovery from errors.

Do not build landing-page hero patterns inside the app shell. Avoid decorative section cards, nested cards, gradient/orb backgrounds, and oversized editorial typography in tool surfaces.

## Layout

- Navigation, sidebars, status bars, and work surfaces must keep stable dimensions. Hover states, counters, labels, loading text, and dynamic content must not shift the layout.
- Use page-level structure as full-width bands or unframed layouts. Use cards only for repeated items, modals, or genuinely framed tools.
- Keep app controls compact but readable. Reserve large display text for true first-screen marketing or documentation pages, not dashboards, panels, or toolbars.
- Verify desktop and narrow viewports for text overflow, overlapping elements, clipped controls, and unusable scroll regions.

## Tokens And Styling

- Use CSS variables for colors, spacing, radius, shadows, and surfaces. Do not hardcode visual constants unless documenting a third-party constraint.
- New UI should prefer v2 tokens (`--v2-*`). Use v1 tokens only to match existing components or migration boundaries.
- Avoid one-hue palettes. Product surfaces should preserve semantic contrast between background, text, border, selection, success, warning, error, and info states.
- Theme changes must work in light and dark variants.

## Components

- Reuse `packages/ui` primitives before creating app-local controls.
- Keep app-specific compositions in `packages/app`. Promote to `packages/ui` only when a component is reusable across multiple product surfaces.
- New shared components should include expected states: default, hover, focus, disabled, loading, empty, and error when applicable.
- Use established icon components for icon buttons. Icon-only controls need accessible labels and, when meaning is not obvious, tooltips.

## Text And I18n

- User-facing product text must go through the i18n dictionaries.
- Do not add visible instructional filler that explains obvious UI mechanics. Empty/error states may explain what happened and what action is available.
- Keep labels short and domain-specific. Prefer commands over vague verbs.

## Accessibility

- Interactive controls must be reachable and operable by keyboard.
- Preserve visible focus states.
- Custom controls need correct ARIA roles, labels, and state attributes.
- Color contrast targets: 4.5:1 for body text and 3:1 for large text or non-text UI indicators.

## Verification

For UI changes, verify:

- Desktop and narrow viewport layout.
- Light and dark themes when the change touches color or surface styling.
- Keyboard focus path for new or changed interactive controls.
- Empty, loading, disabled, and error states affected by the change.
- Text overflow in English and Chinese strings.

Document-only design changes may be verified with `git diff`, link checks, and consistency checks against `CLAUDE.md`, `AGENTS.md`, and relevant package guides.
