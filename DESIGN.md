# AigcForge Design Protocol

> **Role**: Senior UX design
> **Scope**: Product UI in `packages/app/`, shared components in `packages/ui/`, desktop shell surfaces in `packages/desktop/`, terminal-facing UX in `packages/tui/`, session rendering in `packages/session-ui/`, and enterprise routes in `packages/enterprise/`. `packages/web/` is an Astro marketing site and is excluded. `packages/storybook/` is a component showcase and follows the same token and story conventions.
> **Nature**: UI design entry point. Theming engine detail lives in `.aigcfroge/skills/frontend-theming/SKILL.md`.

## Tech Stack

- SolidJS (`solid-js`), `@kobalte/core` for accessible primitives, `@solidjs/router`, `vite-plugin-solid`.
- Tailwind v4 (`@tailwindcss/vite`): `@theme`, `@layer theme, base, components, utilities`. Breakpoints `sm…5xl` (40rem–144rem). Spacing scale 0.25rem.
- Build via Vite; desktop wraps with Electron.

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
- New UI should prefer v2 tokens (`--v2-*`). v2 naming is `--v2-<group>-<semantic>-<variant>` (e.g. `--v2-background-bg-base`, `--v2-text-text-muted`, `--v2-state-bg-success`). Lightness runs `100` = brightest to `1200` = darkest, the **opposite** direction from v1. Definitions live in `packages/ui/src/v2/styles/{colors,theme,tailwind}.css`.
- Use v1 tokens only to match existing components or migration boundaries.
- Avoid one-hue palettes. Product surfaces should preserve semantic contrast between background, text, border, selection, success, warning, error, and info states.
- Theme changes must work in light and dark variants.
- Theming engine internals (DesktopTheme JSON, Oklch engine, 37 built-in themes, ThemeProvider) are documented in `.aigcfroge/skills/frontend-theming/SKILL.md`.

## Theme Switching

- `ThemeProvider` (`packages/ui/src/theme/context.tsx`) is the entry. `applyThemeCss(theme, themeId, mode)` writes resolved CSS to `document.documentElement` and persists via `STORAGE_KEYS`.
- Light/dark variant is selected via the `data-color-scheme` attribute and the `settings-color-scheme` action in settings.
- New surfaces must declare both light and dark token bindings; never assume a single theme.

## CSS Conventions

- Each component lives next to a same-named `.css` file and imports it: `import "./button-v2.css"`.
- Style via `data-component`, `data-variant`, `data-state` attribute selectors — **not** BEM, **not** CSS Modules.
- Reference tokens (`var(--v2-...)`); never hardcode hex/rgb/px in component CSS.

## Components

- Reuse `packages/ui` primitives before creating app-local controls. v1 primitives live in `packages/ui/src/components/`; v2 primitives in `packages/ui/src/v2/components/` (named `*-v2.tsx`).
- New components default to v2. Use v1 only to match existing surfaces or migration boundaries.
- Promote app-local compositions to `packages/ui` only when a component is reusable across multiple product surfaces.
- New shared components should include expected states: default, hover, focus, disabled, loading, empty, and error when applicable.
- Every new shared component must ship a `*.stories.tsx` in `packages/storybook`. v2 primitives are all covered.
- Use established icon components for icon buttons. Icon-only controls need accessible labels (`aria-label`) and, when meaning is not obvious, tooltips.

## Icon System

- v2 icons: inline SVG dictionary in `packages/ui/src/v2/components/icon.tsx`, `stroke="currentColor"`, no external icon library.
- v1 icons: `packages/ui/src/components/app-icons/sprite.svg`, plus `file-icons/` and `provider-icons/`.
- Do not import icon libraries from npm; extend the dictionaries.

## Text And I18n

- User-facing product text must go through the i18n system. The implementation is self-built (`useI18n()` in `packages/ui/src/context/i18n.tsx`); there is no third-party i18n dependency.
- Dictionaries live in `packages/ui/src/i18n/` (shared) and `packages/app/src/i18n/` (app-local), each covering 18 languages. A parity test (`packages/app/src/i18n/parity.test.ts`) guards completeness.
- Keys use dot-namespaced paths (`ui.sessionReview.title`, `command.session.new`). Templates use `{{param}}` placeholders.
- Do not add visible instructional filler that explains obvious UI mechanics. Empty/error states may explain what happened and what action is available.
- Keep labels short and domain-specific. Prefer commands over vague verbs.

## Accessibility

- Interactive controls must be reachable and operable by keyboard. `IconButtonV2` relies on the caller to pass `aria-label`; do not omit it for icon-only buttons.
- Preserve visible focus states.
- Custom controls need correct ARIA roles, labels, and state attributes. Base on `@kobalte/core` for native semantics where possible.
- Color contrast targets: 4.5:1 for body text and 3:1 for large text or non-text UI indicators. There is no automated contrast audit in the repo; verify with the browser DevTools Contrast Checker or the Storybook a11y addon.
- Accessibility verification is manual until a `accessibility-check` tooling is added.

## Verification

For UI changes, verify:

- Desktop and narrow viewport layout.
- Light and dark themes when the change touches color or surface styling.
- Keyboard focus path for new or changed interactive controls.
- Empty, loading, disabled, and error states affected by the change.
- Text overflow in English and Chinese strings.

Document-only design changes may be verified with `git diff`, link checks, and consistency checks against `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, and relevant package guides.
