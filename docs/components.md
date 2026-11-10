# TAKI Travel — shared components (D1)

Import primitives from the barrel `@/components/ui`. Import brand and layout pieces from their own files (`@/components/brand/Logo`, `@/components/layout/PageHeader`, …). All components take `className`. Icons are lucide (`strokeWidth={1.75}`) and are always `aria-hidden` inside controls. Don't write hex colours; use the tokens below.

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)
- **Greens** (the full scale is replaced): `green-50` #F3F8F1 selected bg · `100` · `200` (= mint) · `300` · `400` · `500` #2F7D43 links/map line · `600` success · `700` #0D6336 **primary/focus** · `800` · `900` sidebar · `950` #022A1C text on lime.
- **Lime** `lime-100` (paid tint) · `lime-300` #B4E799 (active pill, Ship Goods, Withdraw; always with `text-green-950`) · `lime-400` (hover).
- **Brand**: `brand-primary` #173D32 · `brand-secondary` · `brand-accent` · page `canvas` #F5F5EF.
- **Surfaces**: `surface` (white) · `surface-muted` · `mint-50/100` · `cream-100` · `border` · `border-strong` · `skeleton`.
- **Ink**: `ink` (headings/body) · `ink-muted` (secondary) · `ink-subtle` (captions, the minimum for text) · `price` · `star`.
- **Status**: `error` (text/borders) · `danger` (pin) · `danger-100` · `info-100/700` · `violet-100/700` · `success-100/700` · `warning-100/700`.
- **Map / waves**: `map-land` · `map-water` · `wave-1/2/3`.
- **Radii**: `rounded-sm` 8 · `md` 12 (buttons, inputs) · `lg` 16 (cards) · `xl` 20 · `2xl` 28 (auth card).
- **Shadows**: `shadow-card` · `shadow-raised` · `shadow-auth` · `shadow-btn`.
- **Gradients**: `bg-grad-sidebar` · `bg-grad-primary` · `bg-grad-earnings` · `bg-grad-payout` · `bg-grad-hero` (90°) · `bg-grad-hero-mobile` (180°).
- **Type**: `font-heading` (Montserrat) / `font-body` (Inter, default). Roles: `type-h1` · `type-h2` · `type-h3` · `type-amount-xl` · `type-amount-lg` · `type-amount-md` (tabular-nums), `text-caption`, `text-display`.
- **Dark surfaces**: add `data-surface="dark"` to a dark container and focus rings inside it turn lime. Card `tone="brand"`, the sidebar, SiteHeader and SiteFooter already set it.
- **Animations**: `animate-shimmer` · `animate-shake` · `animate-pop-in` · `animate-fade-in` (use `motion-safe:`). Reduced motion is honoured globally.
- **Layout**: `--header-height` is 72px. `[id]` targets get `scroll-margin-top`, so `/#about` clears the header.

## Primitives — `@/components/ui`
| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant` primary·secondary·outline·ghost·lime·ghost-dark·danger; `size` sm(36)·md(44)·lg(52); `loading`, `fullWidth`, `leadingIcon`, `trailingIcon` + all `<button>` props | `loading` shows a spinner and sets disabled + `aria-busy`. Keep the progress text as children (`{busy ? "Sending…" : "Send OTP"}`). `type` defaults to `"button"`, so pass `type="submit"` in forms. |
| `ButtonLink` | same + `next/link` props | Pass `aria-disabled` for the disabled look. |
| `buttonClasses({variant,size,fullWidth,className})` | | Styles any element as a button. |
| `IconButton` | `label` (required aria-label), `icon`, `variant` ghost·surface, `size` sm·md, `badge` number·true | Put counts in `label` ("Notifications, 3 unread"). `iconButtonClasses()` styles links the same way. |
| `Input` | `leadingIcon`, `prefix`, `trailingSlot` (unit text or a control), `invalid`, `wrapperClassName` + `<input>` props | 48px. `className` goes on the `<input>`. |
| `PhoneInput` | Input props | Flag, "+91", numeric, `tel-national`, maxLength 10. The value is the 10-digit number. |
| `PasswordInput` | Input props | LockKeyhole icon plus a "Show/Hide password" toggle. `autoComplete` defaults to `current-password`; pass `new-password` on sign-up. |
| `FormField` | `label`, `htmlFor`, `hint?`, `error?`, `required?`, `optionalLabel?`, `hideLabel?` | Injects `id`, `aria-describedby`, `aria-invalid`, `aria-required` into its **single** child. The error renders with `role="alert"`. |
| `Select` | `options: {value,label,disabled?}[]`, `placeholder?`, `leadingIcon?`, `invalid?` | Native select. A placeholder adds an empty disabled option, so use `defaultValue=""`. |
| `OtpInput` | `value`, `onChange(v)`, `onComplete?(v)`, `invalid`, `disabled`, `autoFocus`, `label`, `aria-describedby` | 6 boxes ("Digit N of 6"). Handles paste/autofill, Backspace and arrow keys. To shake again on a second wrong code, change its `key`. |
| `Card` | `as` div·section·article·li, `padding` none·sm·md·lg, `tone` default·muted·brand·selected, `interactive` | `brand` = green earnings gradient with white text. |
| `Badge` | `tone` success·info·warning·danger·neutral·lavender·paid, `size` sm·md, `icon?` | Status tones follow screen-inventory "Cross-screen notes". |
| `Chip` | `label`, `onRemove?` (→ "Remove {label}"), `variant` default·add, `onClick?` | Stop chips / "+ Add Stop". |
| `RadioCard` | native radio props + `label`, `description?`, `icon?`, `aside?` | Whole row clickable. Group the rows inside `<fieldset><legend>` with a shared `name`. |
| `Rating` | `value`, `count?`, `countLabel?`="trips" | ★ 4.8 (124 trips), with screen-reader text. |
| `Avatar` | `name`, `src?`, `size` sm·md·lg, `decorative?` | Initials on mint. |
| `StatCard` | `label`, `value`, `unit?`, `icon`, `href?`, `trend?` | With `href` the whole card is a link. |
| `MiniAreaChart` | `data:number[]`, `ariaLabel`, `tone` onDark·onLight, `width/height` | Responsive SVG sparkline (`role="img"`). |
| `Tabs` | `items {value,label,count?}[]`, `value`, `onChange`, `ariaLabel`, `panelId?` | Arrow/Home/End keys. Tab ids are `${panelId}-tab-${value}`; render `<div role="tabpanel" id={panelId} aria-labelledby=…>`. |
| `Spinner` | `size`, `label`="Loading" (`""` = decorative) | |
| `Skeleton` | `className` (size it), `lines?`, `rounded` | aria-hidden. Wrap the group in `aria-busy` plus sr-only text. |
| `EmptyState` | `icon?`, `title`, `description?`, `action? {label, href} or {label, onClick}`, `headingLevel` 2·3 | |
| `Modal` | `open`, `onClose`, `title`, `description?`, `size` sm·md·lg, `footer?`, `hideClose?` | Native `<dialog>`: inert background, Esc/backdrop call `onClose`, focus returns to the trigger. Content mounts only while open. |
| `ConfirmDialog` | `open`, `title`, `description?`, `confirmLabel`, `cancelLabel`, `tone` default·danger, `loading`, `onConfirm`, `onCancel` | The parent owns `loading`. |
| `Drawer` | `open`, `onClose`, `label`, `side` left·right, `surface` light·dark | Off-canvas sheet on a native dialog. |
| `useToast()` | `toast({title, description?, tone: success·error·info, durationMs?}) → id`, `dismiss(id)` | The provider is already mounted in `app/providers.tsx`. Toasts sit top on mobile, bottom-right on desktop. |

```tsx
import { Button, FormField, Input, useToast } from "@/components/ui";
<FormField label="Source" htmlFor="from" error={errors.from?.message}>
  <Input leadingIcon={<MapPin />} {...register("from")} />
</FormField>
<Button type="submit" size="lg" fullWidth loading={isSubmitting} trailingIcon={<ArrowRight />}>Find Available Vehicles</Button>
```

## Brand — `@/components/brand/*`
- `Logo` `{ variant: "light"|"dark" (the surface it sits on), size sm|md|lg, showWordmark=true, href="/" (null = no link), priority }`: pin symbol plus the "TAKI / TRAVEL" wordmark. On dark surfaces the symbol sits in a cream tile.
- `WaveDecoration` `{ position: "bottom"|"top" }`: three layered green waves, aria-hidden. AuthLayout already includes one.

## Layout — `@/components/layout/*`
- **Route shells are already wired**: `(auth)/layout.tsx` = `GuestOnly` + `AuthLayout`; `customer/layout.tsx` and `driver/layout.tsx` = `DashboardShell role=…` (nav resolved inside the client shell from `@/lib/config/nav` — never pass `nav` from a server component) wrapping `RequireRole`. **Pages must not add another `<main>`.** The shells provide `<main id="main">`. Only public pages (landing) render their own `<main id="main">`.
- `AuthCardHeader` `{ title, subtitle?, backHref?, backLabel? }`: put it first in every auth page. It renders the h1 and puts the back arrow in the card's top-left corner.
  ```tsx
  <AuthCardHeader title="Verify OTP" backHref={paths.phone({ flow, role })} subtitle={<>Enter the 6-digit code for <strong>…</strong></>} />
  ```
- `TopBar` `{ title?, emoji?, subtitle?, notificationsCount?, user?, profileHref?, onLogout? }`: dashboard greeting h1 with a bell (unread dot plus a notifications panel from `useNotifications()`) and an avatar menu (Profile, Log out). `user`, `profileHref` and `onLogout` default to the session, so the usual call is `<TopBar title={`Hi, ${user.firstName}`} emoji="👋" subtitle="Where are we shipping today?" />`. Leave `onMenuClick` unset inside the shell, which already has a menu button below lg.
- `PageHeader` `{ title, count?, backHref?, onBack?, backLabel?, subtitle?, actions? }`: the h1 for inner and flow pages. Example: `<PageHeader title="Available Vehicles" count={offers.length} backHref={paths.customer.dashboard} />`.
- `DemoBanner` `{ kind: "otp"|"payment"|"payout"|"map"|"general", title?, children?, compact?, data-testid? }`: an honest demo notice (`role="note"`). Default titles: otp "Demo mode — no SMS is sent", payment "Demo payment — no money moves", payout "Demo payout — no money moves", map "Illustrative route — not live location". It is hidden in live mode, except `map`. Example: `<DemoBanner kind="otp" data-testid="demo-otp-code">Your code is {code}</DemoBanner>`.
- `SiteHeader` `{ links? (defaults to the 4 landing anchors), tone: "overlay"|"solid" }`: overlay is `position:fixed` and transparent, and turns solid after 24px of scroll. A hero under it should pad its top by `var(--header-height)`. The Login pill switches to "Dashboard" once a signed-in session hydrates. Below md it shows a hamburger that opens `MobileNavDrawer`.
- `SiteFooter` `{ links? }`: forest-green footer with the logo, nav, get-started links, © year, and an "images are illustrative" note.
- `RequireRole` `{ role, fallback? }` and `GuestOnly`: these are already used by the route layouts. GuestOnly sends a signed-in user to `safeRedirect(?next)` or their dashboard, the same target the login form uses, so the two don't race.
- `useLogout()`: returns `logout()`, which clears the session, replaces to `/` and shows the toast "You've been logged out". Use it for Profile-page "Log out" buttons.
- `DashboardSkeleton`: the content-area skeleton shown while the session hydrates.
- `DashboardShell`, `DashboardSidebar`, `MobileNavDrawer`, `SkipLink`: used internally by the shells and root layout.

## Conventions
- Each page has one `h1` (TopBar, PageHeader or AuthCardHeader provides it). Section headings are `h2`.
- Content width: the shell's main is max 1120px plus gutters. For single-form pages, wrap the content in `max-w-[720px]`.
- Touch targets are at least 44px. Small buttons and icon buttons grow on coarse pointers automatically.
