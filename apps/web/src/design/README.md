# Saunaklar design system

One brand hue per tenant. `theme.ts` derives every token (`--ink`…`--ink-6`, `--paper`…`--paper-3`, `--line`, `--on-ink`, `--focus`) from it in OKLCH, with guaranteed contrast and a dark mode. Use only the tokens. Never hard-code colours, except black-on-white QR codes.

## Foundations

- `theme.ts`: `deriveTheme(hex)` returns light and dark tokens. `applyTheme(hex)` installs them and the theme-color meta.
- `color.ts`: OKLCH conversion, gamut clamping and WCAG contrast.
- `global.css`: tokens, the fluid type scale (`--step--2`…`--step-7`), spacing (`--space-1`…`--space-10`), and the utilities `.container`, `.eyebrow`, `.mono`, `.lede`, `.prose`, `.sr-only` and `.skip-link`.
- `layout.css`: page-level layout (`.page`, `.page-title`, `.section`, `.split`, `.kv`).
- `useInView.ts`: an IntersectionObserver hook for lazy work.

## Components (`components/`)

- `Icon`: the single wrapper for lucide icons (size and stroke).
- `Button`, `ButtonLink`, `IconButton`: primary, ghost, link and quiet variants. String labels use FlipText, and `loading` shows a spinner.
- `TextLink`, `TextNavLink`, `ExternalLink`: text links with an animated underline. `warm` prefetches the route on hover or focus.
- `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`: labelled fields with hint, error, Required/Optional marker and a password toggle.
- `Card`, `CardHeader`: outline, filled or plain surfaces.
- `Badge`, `StatusBadge`: single-colour status, where weight and fill carry the meaning.
- `Table`: sortable (`aria-sort`), with an empty state and skeleton. It stacks into label/value rows on phones.
- `Tabs`: roving-tabindex tabs.
- `Dialog`, `Drawer`: a native `<dialog>` with focus trap and a GSAP entrance.
- `Toast`, `Toaster`: `toast(title, body?)` and `toast.error(...)`.
- `Skeleton`: shimmer blocks or lines matched to the final layout.
- `Stepper`: a numbered progress row.
- `Price`: money with an optional strike-through list price. Digits scramble when the value changes.
- `Swatch`: a colour chip or radio for options.
- `Segmented`: a single-choice pill group.
- `LoadMore`: cursor pagination footer.
- `EmptyState`: icon, title, body and action.
- `ErrorBoundary`, `ErrorPage`, `RouteErrorPage`: problem+json-aware error screens.
- `Accordion`: a disclosure list (FAQ).
- `LazyImage`: AVIF/WebP srcset, lazy loading, intrinsic size and a placeholder.
- `Breadcrumbs`: a trail of mono crumbs.
- `SectionHeading`: eyebrow, scrambled title and lede.
- `Menu`: an accessible dropdown menu.

## Motion (`../motion/`)

- `gsap.ts`: registers the plugins once (ScrambleText, SplitText, Flip, ScrollTrigger, ScrollTo, CustomEase) and the eases `sk.out`, `sk.inOut` and `sk.snap`.
- `preferences.ts`: `prefersReducedMotion`, `useReducedMotion` and `prefersSaveData`.
- `useScramble` / `ScrambleText`: noisy-letter text on mount, in view, hover or on demand.
- `FlipText`: a vertical flip-flop letter roller (SplitText).
- `Reveal`: ScrollTrigger batch reveals.
- `useFlipLayout`: Flip transitions for filtered or reordered grids (`capture()` before the change).
- `PageTransition`, `NavigationProgress`: the route curtain and the top progress bar.
- `Marquee`: an endless strip.
- `Magnetic`: a pointer-follow nudge.
- `NumberTicker`: count-up numbers.

## Staff areas (`../staff/`)

- `StaffLogin`: password, new-password and TOTP (code or setup with a QR code) challenges.
- `RequireStaff`: renders children for staff of a scope, otherwise the sign-in in place.
- `AdminShell`: sidebar or tab-bar navigation, user block, language switch and sign-out.
- `PageHead`, `Panel`: an admin page title row and titled blocks.
- `StatTile`, `StatGrid`, `BarChart`, `HBarList`: single-hue charts with tooltips and screen-reader tables.
- `useCursorList`: `{ items, nextCursor }` pages flattened for lists.
- `qr.ts`: `qrMatrix(text)`, a dependency-free QR encoder.
