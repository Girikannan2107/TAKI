# Component Contract — TAKI Travel website (P2)

Shared and feature components: file path, owner, client/server, TypeScript props.
Rules for all components:
- React 19: `ref` is a normal prop (no `forwardRef`). Native-element wrappers extend the element's props (`ComponentPropsWithRef<"button">`) and spread the rest.
- Variants are explicit string unions, not boolean piles. Class merging via `cn()` (`src/lib/utils/cn.ts`).
- Named exports only; one component per file; file name = component name (`Button.tsx`). Barrel `src/components/ui/index.ts` allowed for ui primitives only.
- `"use client"` only where needed (state, effects, handlers, store). Marked **C** (client) / **S** (server-safe) below.
- Every interactive element: visible focus ring (token from P1), min 44×44 hit area on touch, accessible name.
- Visual tokens (colours, radii, shadows, spacing) come from P1's design-tokens doc via `@theme` utilities; no hex values in components.
- Money props are integer rupees (`Rupees`) formatted inside with `formatINR`; rates are `Paise`; dates are ISO strings formatted with `formatDate`.

Owners: **D1** design system/shell · **D2** landing · **D3** auth · **D4** customer dashboard & vehicles · **D5** booking details · **D6** payment & tracking · **D7** driver dashboard & route creation · **D8** pricing, booking requests, earnings.

## 1. Primitives — `src/components/ui/` (D1)

```ts
// Button.tsx  (S; works in server components when rendered as a Link)
type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "lime" | "ghost-dark" | "danger";   // per P1 ui-design-spec: lime = "Ship Goods"/"Withdraw", ghost-dark = "List a Route"
type ButtonSize = "sm" | "md" | "lg";
interface ButtonBaseProps { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; fullWidth?: boolean;
  leadingIcon?: React.ReactNode; trailingIcon?: React.ReactNode; }
export type ButtonProps = ButtonBaseProps & React.ComponentPropsWithRef<"button">;
export function Button(props: ButtonProps): React.JSX.Element;            // loading => disabled + aria-busy + Spinner
export type ButtonLinkProps = ButtonBaseProps & Omit<React.ComponentProps<typeof Link>, "className"> & { className?: string };
export function ButtonLink(props: ButtonLinkProps): React.JSX.Element;    // next/link styled as Button

// IconButton.tsx (S)
export interface IconButtonProps extends React.ComponentPropsWithRef<"button"> {
  label: string;                     // required -> aria-label
  icon: React.ReactNode; variant?: "ghost" | "surface"; size?: "sm" | "md"; badge?: number | boolean; }

// Input.tsx (S)
export interface InputProps extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
  leadingIcon?: React.ReactNode;     // e.g. MapPin, Lock
  trailingSlot?: React.ReactNode;    // e.g. unit text "/ km", password eye toggle
  prefix?: React.ReactNode;          // e.g. flag + "+91"
  invalid?: boolean; }
// PasswordInput.tsx (C) — Input + show/hide IconButton ("Show password"/"Hide password")
export type PasswordInputProps = Omit<InputProps, "type" | "trailingSlot">;

// FormField.tsx (S) — label + control + hint + error; injects id/aria-describedby/aria-invalid into child
export interface FormFieldProps {
  label: string; htmlFor: string; hint?: string; error?: string; required?: boolean; optionalLabel?: boolean;   // "(optional)"
  hideLabel?: boolean;               // visually hidden, still accessible
  children: React.ReactNode; className?: string; }

// Select.tsx (S) — native <select> styled (robust on mobile, accessible)
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends Omit<React.ComponentPropsWithRef<"select">, "children"> {
  options: SelectOption[]; placeholder?: string; leadingIcon?: React.ReactNode; invalid?: boolean; }

// Card.tsx (S)
export interface CardProps extends React.ComponentPropsWithRef<"div"> {
  as?: "div" | "section" | "article" | "li"; padding?: "none" | "sm" | "md" | "lg";
  tone?: "default" | "muted" | "brand" | "selected"; interactive?: boolean; }   // brand = dark-green earnings card

// Badge.tsx (S)
export interface BadgeProps { tone?: "success" | "info" | "warning" | "danger" | "neutral" | "lavender";  // "More Capacity" chip
  size?: "sm" | "md"; icon?: React.ReactNode; children: React.ReactNode; className?: string; }

// Spinner.tsx (S)
export interface SpinnerProps { size?: "sm" | "md" | "lg"; label?: string /* default "Loading" */; className?: string }

// Skeleton.tsx (S)
export interface SkeletonProps { className?: string; lines?: number; rounded?: "sm" | "md" | "full" }

// OtpInput.tsx (C) — 6 boxes, paste support, autocomplete="one-time-code", inputMode="numeric"
export interface OtpInputProps {
  length?: 6; value: string; onChange(value: string): void; onComplete?(value: string): void;
  disabled?: boolean; invalid?: boolean; autoFocus?: boolean; "aria-describedby"?: string;
  label?: string; }                  // group label, default "One-time password"

// Toast.tsx + useToast.ts (C) — provider mounted in app/providers.tsx; aria-live="polite" region
export type ToastTone = "success" | "error" | "info";
export interface ToastOptions { title: string; description?: string; tone?: ToastTone; durationMs?: number /* 4000 */ }
export function ToastProvider(props: { children: React.ReactNode }): React.JSX.Element;
export function useToast(): { toast(opts: ToastOptions): string; dismiss(id: string): void };

// Modal.tsx (C) — native <dialog> with showModal(): focus trap, Esc, inert background, returns focus
export interface ModalProps { open: boolean; onClose(): void; title: string; description?: string;
  size?: "sm" | "md" | "lg"; children: React.ReactNode; footer?: React.ReactNode; }
// ConfirmDialog.tsx (C)
export interface ConfirmDialogProps { open: boolean; title: string; description?: string;
  confirmLabel?: string; cancelLabel?: string; tone?: "default" | "danger"; loading?: boolean;
  onConfirm(): void | Promise<void>; onCancel(): void; }

// EmptyState.tsx (S)
export interface EmptyStateProps { icon?: React.ReactNode; title: string; description?: string;
  action?: { label: string; href: string } | { label: string; onClick(): void }; }

// StatCard.tsx (S) — driver dashboard tiles
export interface StatCardProps { label: string; value: string | number; unit?: string; icon: React.ReactNode;
  href?: string;                     // whole card becomes a Link
  trend?: { direction: "up" | "down"; text: string }; }

// Chip.tsx (S) — stop chips "Salem ×" (per P1)
export interface ChipProps { label: string; onRemove?(): void /* renders remove button aria-label="Remove {label}" */;
  variant?: "default" | "add"; onClick?(): void; }

// Tabs.tsx (C) — used by shipments/bookings; drives a URL param via onChange
export interface TabsProps { items: { value: string; label: string; count?: number }[]; value: string;
  onChange(value: string): void; ariaLabel: string; }
```

## 2. Brand — `src/components/brand/` (D1)

```ts
// Logo.tsx (S) — pin symbol image (next/image, public/assets/taki/branding/taki_symbol_transparent.png) + "TAKI / TRAVEL" Montserrat wordmark
// Names per P1: variant = the SURFACE it sits on ("dark" = hero/sidebar). On dark, symbol sits in a 40px cream tile.
export interface LogoProps { variant?: "light" | "dark"; size?: "sm" | "md" | "lg"; showWordmark?: boolean /* default true */;
  href?: string | null /* default "/" ; null = not a link */; priority?: boolean; }   // wrapper aria-label "TAKI Travel home"

// WaveDecoration.tsx (S) — decorative SVG waves at auth card bottom; aria-hidden
export interface WaveDecorationProps { position?: "bottom" | "top"; className?: string }
```

## 3. Layout — `src/components/layout/` (D1)

```ts
// SiteHeader.tsx (S shell + C island for menu/session CTA) — landing header over hero
export interface NavLink { label: string; href: string }
export interface SiteHeaderProps { links: NavLink[]; tone?: "overlay" | "solid" }   // overlay = transparent on hero

// MobileNavDrawer.tsx (C)
export interface MobileNavDrawerProps { open: boolean; onClose(): void; links: NavLink[];
  cta?: { label: string; href: string }; }

// DashboardShell.tsx (C) — sidebar (>= lg) / drawer (< lg) + main region + skip link target #main
export type Role = "customer" | "driver";
export interface NavItem { label: string; href: string; icon: LucideIcon; matchPrefixes: string[] }
export interface DashboardShellProps { role: Role; nav: NavItem[]; children: React.ReactNode }

// DashboardSidebar.tsx (C) — dark-green panel, Logo (light), nav with pale-lime active pill, Log out at bottom
export interface DashboardSidebarProps { nav: NavItem[]; activeHref: string; onNavigate?(): void /* closes drawer */;
  onLogout(): void; variant?: "fixed" | "drawer"; }

// TopBar.tsx (C) — greeting row: "Hi, {name} 👋" + subtitle, bell IconButton, avatar menu; menu button < lg
export interface TopBarProps { title?: React.ReactNode /* e.g. "Hi, Arjun" */; subtitle?: string;
  onMenuClick?(): void; notificationsCount?: number; user: { name: string; avatarUrl?: string };
  profileHref: string; onLogout(): void; }

// PageHeader.tsx (S) — back arrow + title (+ count) + optional actions
export interface PageHeaderProps { title: string; count?: number /* "Available Vehicles (3)" */;
  backHref?: string; onBack?(): void; subtitle?: React.ReactNode; actions?: React.ReactNode; }

// AuthLayout.tsx (S) — centred card on brand background, Logo top, optional back arrow, WaveDecoration bottom
export interface AuthLayoutProps { children: React.ReactNode; backHref?: string; title?: string; subtitle?: React.ReactNode }
// (route-level (auth)/layout.tsx renders the frame; pages render AuthCardHeader for title/back)
export interface AuthCardHeaderProps { title: string; subtitle?: React.ReactNode; backHref?: string }

// DemoBanner.tsx (S) — clearly labelled notice; never implies real SMS/payment/GPS
export interface DemoBannerProps { kind: "otp" | "payment" | "payout" | "map" | "general";
  title?: string /* default by kind e.g. "Demo mode" */; children?: React.ReactNode; compact?: boolean; }

// RequireRole.tsx (C) and GuestOnly.tsx (C) — guards (see technical-architecture.md §6)
export interface RequireRoleProps { role: Role; children: React.ReactNode; fallback?: React.ReactNode }
export interface GuestOnlyProps { children: React.ReactNode }

// SkipLink.tsx (S) — "Skip to main content" -> #main
```

## 4. Feature components — `src/features/<domain>/`

Domain types (`Shipment`, `VehicleOffer`, `Booking`, `BookingStatus`, `BookingRequestStatus`, `Route`, `RouteDraft`, `PricingBreakdown`, `EarningEntry`, `EarningsSummary`, `PaymentMethod`, `City`, `Rupees`, `Paise`) come from `@/lib/domain/types` (P3). Shapes below reference them; P3 field names win.

| Component | File | Owner | C/S |
|---|---|---|---|
| HeroSection, HowItWorks, BenefitsSection, AboutSection, ContactSection, SiteFooter | `features/landing/*.tsx` | D2 | S (CTA island C) |
| RoleCard | `features/auth/RoleCard.tsx` | D3 | S |
| PhoneForm, OtpForm, CreatePasswordForm, LoginForm, PasswordChecklist | `features/auth/*.tsx` | D3 | C |
| ShipmentForm | `features/customer-search/ShipmentForm.tsx` | D4 | C |
| SearchSummaryBar | `features/customer-search/SearchSummaryBar.tsx` | D4 | S |
| VehicleCard | `features/customer-search/VehicleCard.tsx` | D4 | S |
| RouteMap | `features/booking/RouteMap.tsx` | D5 | S |
| RouteStatsRow, OperatorHeader | `features/booking/*.tsx` | D5 | S |
| BookingSummary | `features/booking/BookingSummary.tsx` | D5 (used by D6) | S |
| PaymentMethodSelector | `features/payment/PaymentMethodSelector.tsx` | D6 | C |
| StatusTimeline | `features/tracking/StatusTimeline.tsx` | D6 | S |
| ShipmentListItem | `features/shipments/ShipmentListItem.tsx` | D4 | S |
| EarningsHeroCard (dashboard "Total Earnings") | `features/driver-dashboard/EarningsHeroCard.tsx` | D7 | S |
| RouteForm, StopsInput | `features/driver-routes/*.tsx` | D7 | C |
| RouteListItem | `features/driver-routes/RouteListItem.tsx` | D7 | S |
| PricingForm, PricePreview | `features/driver-routes/pricing/*.tsx` | D8 | C / S |
| BookingRequestCard | `features/driver-requests/BookingRequestCard.tsx` | D8 | S (buttons call props) |
| EarningsCard, SettlementList, WithdrawDialog | `features/earnings/*.tsx` | D8 | S / S / C |
| MiniAreaChart | `components/ui/MiniAreaChart.tsx` | D1 (used by D7, D8) | S |
| ProfileForm | `features/profile/ProfileForm.tsx` | D3 | C |

Each feature folder also holds its route view (`<Name>View.tsx`, C) and skeleton (`<Name>Skeleton.tsx`, S), e.g. `features/booking/BookingDetailsView.tsx`.

```ts
// ShipmentForm (D4)
export interface ShipmentFormProps { defaultValues?: Partial<ShipmentSearchInput>; cities: City[];
  onSubmit(values: ShipmentSearchInput): void | Promise<void>; submitLabel?: string /* "Find Available Vehicles" */; }

// VehicleCard (D4)
export interface VehicleCardProps { offer: VehicleOffer;   // businessName, ratingAvg, ratingCount, vehicleLabel, availableCapacityKg, imageKey, pricing.totalPayable, badge
  href: string;                      // "View & Select" link -> /customer/booking/<offer.routeId>
  headingLevel?: 2 | 3; }

// RouteMap (D5) — static SVG/illustration; NOT a live map
export interface RouteMapProps { from: { name: string }; to: { name: string }; stops?: { name: string }[];
  variant?: "card" | "modal"; caption?: string /* default "Illustrative route — not live location" */; className?: string; }

// BookingSummary (D5)
export interface BookingSummaryProps { breakdown: PricingBreakdown;  // transportationCharge, serviceFee, totalPayable
  title?: string /* "Booking Summary" */; emphasis?: "default" | "large"; footnote?: React.ReactNode; }

// PaymentMethodSelector (D6) — radiogroup (native radios, arrow-key nav)
export interface PaymentMethodOption { value: PaymentMethod /* "upi" | "card" | "netbanking" */; label: string; description?: string; icon: React.ReactNode }
export interface PaymentMethodSelectorProps { value: PaymentMethod; onChange(value: PaymentMethod): void;
  options?: PaymentMethodOption[]; disabled?: boolean; name?: string; }

// StatusTimeline (D6) — ordered list; aria-current="step" on current
export interface TimelineStep { key: BookingStatus; label: string; detail?: string; timestamp?: string; state: "done" | "current" | "upcoming" }
export interface StatusTimelineProps { steps: TimelineStep[]; orientation?: "vertical" }

// BookingRequestCard (D8)
// view model built in the view from Booking + derived BookingRequestStatus (there is no stored request entity)
export interface BookingRequestView { bookingId: BookingId; fromCity: string; toCity: string; weightKg: number; pickupDate: IsoDate;
  customerName: string; driverEarnings: Rupees /* = pricing.transportationCharge */; status: BookingRequestStatus }
export interface BookingRequestCardProps { request: BookingRequestView;
  onAccept(id: string): void | Promise<void>; onDecline(id: string): void;   // decline opens ConfirmDialog in parent
  busy?: boolean; }

// EarningsCard (D8) — "Available for Payout ₹28,500" + Withdraw
export interface EarningsCardProps { availableAmount: number; label?: string; onWithdraw?(): void; withdrawDisabled?: boolean }

// EarningsHeroCard (D7) — "Total Earnings (This Month) ₹28,500 ▲ +12% vs last month" + MiniAreaChart
export interface EarningsHeroCardProps { amount: number; changePct: number; series: number[]; href?: string }

// MiniAreaChart (D1) — decorative sparkline SVG; data summarized in sr-only text
export interface MiniAreaChartProps { data: number[]; width?: number; height?: number;
  tone?: "onDark" | "onLight"; ariaLabel: string /* e.g. "Earnings trend, up 12% vs last month" */; }

// StatsGrid usage on driver dashboard: four <StatCard> (Active Routes, Booking Requests, Completed Trips, Available Capacity)

// PricingForm (D8)
export interface PricingFormProps { draft: RouteDraft; defaultValues?: Partial<RoutePricingInput>;
  onSubmit(values: RoutePricingInput): void | Promise<void>; }
export interface PricePreviewProps { exampleWeightKg: number; distanceKm: number; ratePerKmPaise: Paise; ratePerKgPaise: Paise } // uses domain/pricing

// RouteForm (D7)
export interface RouteFormProps { defaultValues?: Partial<RouteDraftInput>; cities: City[]; vehicleTypes: SelectOption[];
  onSubmit(values: RouteDraftInput): void; }
export interface StopsInputProps { value: string[]; onChange(stops: string[]): void; cities: City[]; max?: number /* 5 */ }

// RoleCard (D3)
export interface RoleCardProps { role: Role; title: string; description: string; icon: React.ReactNode; href: string; selected?: boolean }

// PasswordChecklist (D3)
export interface PasswordChecklistProps { value: string }   // rules from schemas/password.schema.ts; aria-live="polite"
```

## 5. Hooks (D1 unless noted)

| Hook | File | Signature |
|---|---|---|
| useHydrated | `lib/hooks/useHydrated.ts` | `(): boolean` |
| useSession | `lib/hooks/useSession.ts` | `(): { session: Session \| null; hydrated: boolean; logout(): Promise<void> }` |
| useRequireRole | `lib/hooks/useRequireRole.ts` | `(role: Role): { ready: boolean }` (used by RequireRole) |
| useIdempotentAction | `lib/hooks/useIdempotentAction.ts` (D6) | `<T>(key: string, fn: () => Promise<T>) => { run(): Promise<T>; pending: boolean }` |
| useCountdown | `lib/hooks/useCountdown.ts` (D3) | `(seconds: number) => { remaining: number; restart(): void; done: boolean }` |
| useCopyToClipboard | `lib/hooks/useCopyToClipboard.ts` | `() => (text: string) => Promise<boolean>` |
| useMediaQuery | not provided — use CSS breakpoints instead | — |

## 6. Test hooks

- `data-testid` only where role/label is ambiguous: `demo-otp-code`, `vehicle-card`, `booking-request-card`, `timeline-step`, `price-total`, `booking-id`.
- All icons inside buttons are `aria-hidden`; IconButton requires `label`.
- Components must render without the store (props only) so they can be unit/visual tested in isolation; views wire the store.

## 7. Delivery order (Phase 2 dependencies)

1. D1 day-1: `cn`, tokens in `globals.css`, Button/ButtonLink, Input, FormField, Select, Card, Badge, Spinner, Skeleton, Logo, AuthLayout, DashboardShell + Sidebar + TopBar + PageHeader, DemoBanner, Toast, Modal/ConfirmDialog, EmptyState, StatCard, `useHydrated`, store skeleton. Props frozen as above; visual polish can follow.
2. P3 domain/data files land in parallel (types, seed, pricing, booking machine).
3. D2–D8 build views against these contracts; changes to a shared prop interface go through the lead.
