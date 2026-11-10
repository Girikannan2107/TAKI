# UI Design Spec — TAKI Travel (P1)

Source: `Reference.jpeg` (1536×1024 board, 15 panels) + `references/screens/*.png`, brand kit README/guide.
Colours below were sampled with PIL (median / dominant-bucket over small regions) from the JPEG, then rounded to usable tokens. JPEG compression shifts values by ±4 per channel; the "token" column is the value to implement.

## 1. Design principles
- Calm, trustworthy logistics UI: deep forest greens, cream page, white cards, one lime accent for "current/primary on dark".
- Board panels are compressed mock-ups. Build **full-size responsive pages**; keep the hierarchy, copy and colours, not the panel sizes.
- Not UI: the arrows between panels, and the "Customer Journey (Ship Goods)" / "Driver Journey (List Route & Manage Bookings)" pills. These are board annotations.
- Demo honesty: no copy may claim that an SMS was sent, that a payment was real, or that GPS is live (see screen-inventory "Demo copy" notes).

## 2. Colour tokens

### 2.1 Brand (from kit, authoritative)
| Token | Hex | Usage |
|---|---|---|
| `--taki-primary` | `#173D32` | Footer bg, headings on light (alternative to ink), focus ring on light, dark surfaces |
| `--taki-secondary` | `#286B50` | Secondary icons, links, outline-button text |
| `--taki-accent` | `#83B99A` | Decorative strokes, sparkline, wave mid-tone, dividers on dark |
| `--taki-bg` | `#F5F5EF` | Page background (board sampled `#F8F8F3`–`#FCFBF9`) |
| `--taki-text` | `#242B29` | Body text / ink (board heading text sampled ≈ `#1F211F`) |

### 2.2 Sampled UI palette (Tailwind `@theme` names suggested)
| Token | Sampled | Token hex | Usage |
|---|---|---|---|
| `green-950` | `#002619`, `#023925` | `#022A1C` | Hero overlay start, darkest sidebar top |
| `green-900` | `#013221`, `#024029` | `#033524` | Sidebar gradient top, "List a Route" ghost-button fill |
| `green-800` | `#02512B`, `#084426` | `#0A5530` | Button gradient bottom, Accept button, "View & Select" |
| `green-700` | `#0D6336`, `#0A5E31` | `#0D6336` | **Primary action** (Send OTP, Verify, Find Available Vehicles, Pay, Book…) |
| `green-600` | `#1A7340`, `#1C6A40` | `#1A7340` | Sidebar gradient bottom, earnings card mid, timeline done |
| `green-500` | `#398847`, `#22783B` | `#2F7D43` | Route line on map, hero eyebrow pill (darkened for AA), links on hover |
| `lime-300` | `#B4E799`, `#AFE592`, `#B6E69E` | `#B4E799` | Active sidebar pill, "Ship Goods" CTA, "Withdraw" button |
| `lime-100` | `#D5F1C7`, `#D4F1CE` | `#D5F1C7` | "Paid" badge, success tint |
| `mint-100` | `#DAEDD9`, `#DBEDDA`, `#D3EDC8` | `#DAEDD9` | Icon discs (booking request, truck circle), "+ Add Stop" chip |
| `mint-50` | `#E7F2E5`, `#E0EEE0` | `#E6F2E4` | "Your Earnings" box, price-preview highlighted row |
| `cream-100` | `#F2F4E6` | `#F2F4E6` | Price Preview panel background |
| `surface` | `#FBFAF8`, `#F9FAF5` | `#FFFFFF` | Cards, inputs, auth card (use pure white for contrast) |
| `surface-muted` | `#F1F3ED`, `#F7F7F2` | `#F1F3ED` | Removable stop chips, payment-method icon tiles, table stripes |
| `border` | `#E4E5E0`, `#E9E8E4` | `#E4E6E0` | Card/input borders (1px) |
| `border-strong` | `#DADFD9` | `#D3D8D2` | Outline buttons (Decline), radio ring, hover border |
| `ink` | `#1F211F`, `#232321` | `#242B29` | Headings + body (= brand text) |
| `ink-muted` | grey text | `#5E6661` | Secondary text ("Search for vehicles on your route.") — 5.9:1 on white |
| `ink-subtle` | — | `#6B726D` | Captions/meta — 4.9:1 on white (minimum allowed for text) |
| `price` | `#2A5F43`, `#145A32` | `#145A32` | Prices (₹4,850), totals — 8.3:1 on white |
| `star` | `#F1BE49`, `#F4B524` | `#F4B524` | Rating star fill (decorative; rating number stays ink) |
| `danger` | pin `#BA2930` | `#C8322F` | Destination pin, error icon; error text `#B42318` |
| `info-100` / `info-700` | `#D5E6F7` | `#DCEAF8` / `#1E4E8C` | "Top Rated" badge |
| `violet-100` / `violet-700` | `#D4CAFF`, `#CEE1ED` | `#E6E0FB` / `#5B3FB0` | "More Capacity" badge |
| `success-100` / `success-700` | `#B0F2B8` | `#CDEFD0` / `#0F5A2E` | "Best Price" badge |
| `warning-100` / `warning-700` | — | `#FDF0D5` / `#8A4B00` | Pending / demo banners |
| `map-land` | `#E1F1D9`, `#ECF5E6` | `#E3F1DA` | Illustrative map fill |
| `map-water` | light blue lines | `#CFE5EE` | Rivers/coast on map SVG |
| `wave-1/2/3` | `#B9E0B4`, `#7AB973`, `#5DA273` | same | Auth wave layers (front→back) |

Contrast fixes vs. board: hero eyebrow pill sampled `#50A45C` + white text = 3.0:1 (fails) → use `#2F7D43` (5.1:1). Lime `#B4E799` always carries `green-950`/`#0A3B26` text (8.9:1), never white.

### 2.3 Gradients
| Name | Value |
|---|---|
| `grad-sidebar` | `linear-gradient(180deg,#022A1C 0%,#05402B 55%,#1A6A40 100%)` (sampled top `#024029`→bottom `#1C6A40`) |
| `grad-hero-overlay` | `linear-gradient(90deg,rgba(2,42,28,.96) 0%,rgba(2,57,37,.88) 34%,rgba(2,57,37,.45) 58%,rgba(2,57,37,0) 78%)`; mobile: `180deg` version, bottom-heavy |
| `grad-primary-btn` | `linear-gradient(180deg,#11703D 0%,#0A5530 100%)` (flat fallback `#0D6336`) |
| `grad-earnings` | `linear-gradient(110deg,#1A8348 0%,#0E6238 55%,#085930 100%)` + decorative sparkline `rgba(180,231,153,.55)` |
| `grad-payout` | `linear-gradient(120deg,#3A8A4B 0%,#145533 55%,#0A3E28 100%)` |

## 3. Typography
Fonts via `next/font/google`: **Montserrat** (400/500/600/700) → `--font-heading`; **Inter** (400/500/600) → `--font-body`. `display: swap`. Board text renders as a geometric grotesk; Montserrat is the brand-mandated substitute (wider — allow line wraps).

| Role | Font / weight | Desktop size/line | Mobile | Examples |
|---|---|---|---|---|
| `display` | Montserrat 700, `-0.02em` | 56–60/1.08 (`clamp(2.25rem,1.3rem+3.2vw,3.75rem)`) | 36/1.12 | "Your goods. Their route. One smart connection." |
| `h1` | Montserrat 700 | 32/40 | 26/32 | "Hi, Arjun 👋", "Join TAKI Travel", "Verify OTP" (auth 30/38) |
| `h2` | Montserrat 700 | 24/32 | 20/28 | Page titles beside back arrow ("Available Vehicles (3)"), "How TAKI Works" (32 on landing) |
| `h3` | Montserrat 600 | 18/26 | 17/24 | Card titles ("New Shipment", "Booking Summary", "Raj Transport") |
| `body-lg` | Inter 400 | 18/28 | 16/24 | Hero sub-copy, auth subtitle |
| `body` | Inter 400 | 16/24 | 15/22 | Default |
| `body-sm` | Inter 400/500 | 14/20 | 14/20 | Meta ("Tata 407 \| 2,000 kg available"), list rows |
| `caption` | Inter 500 | 12/16 | 12/16 | Badges, stat labels, "(optional)" |
| `label` | Inter 500 | 14/20 | 14/20 | Form labels ("Source", "Cargo Weight") |
| `button` | Montserrat 600 | 16 (lg/md), 14 (sm) | same | All buttons |
| `amount-xl` | Montserrat 700, tabular-nums | 40/48 | 32/40 | "₹28,500" earnings/payout cards |
| `amount-lg` | Montserrat 700, tabular-nums | 28/36 | 24/32 | "₹4,850" Total Payable, "₹6,226" Your Earnings |
| `amount-md` | Montserrat 700, tabular-nums | 20/28 | 20/28 | Vehicle card price "₹4,850", stat values "03" |
| `otp-digit` | Montserrat 600 | 24 | 22 | OTP boxes |
| `nav` | Montserrat 600 | 15 | 16 (drawer) | Header + sidebar links |

All currency/number cells use `font-variant-numeric: tabular-nums`.

## 4. Radii, shadows, spacing, sizes
| Radius token | px | Used for |
|---|---|---|
| `r-sm` | 8 | Badges (non-pill), small icon tiles, OTP inner |
| `r-md` | 12 | Buttons, inputs, selects, OTP boxes, list rows |
| `r-lg` | 16 | Cards, vehicle cards, map frame, summary panels |
| `r-xl` | 20 | Landing "How TAKI Works" card, earnings/payout cards, hero (bottom corners on desktop) |
| `r-2xl` | 28 | Auth card |
| `r-full` | 9999 | Pills, chips, avatar, icon discs, radio, status dots |

| Shadow | Value |
|---|---|
| `shadow-card` | `0 1px 2px rgba(23,61,50,.05), 0 4px 14px rgba(23,61,50,.06)` |
| `shadow-raised` | `0 8px 28px rgba(23,61,50,.10)` (hover card, how-it-works card overlapping hero) |
| `shadow-auth` | `0 24px 60px rgba(23,61,50,.12)` |
| `shadow-btn` | `0 6px 14px rgba(13,99,54,.22)` (primary only) |
| `ring-focus` | `outline:2px solid #0D6336; outline-offset:2px` (light) / `outline:2px solid #B4E799` (dark surfaces) |

Spacing: 4-px scale. Page gutter 16 (<640) / 24 (640–1023) / 32 (≥1024). Card padding 20 mobile / 24 desktop. Stack gaps 12 (form fields), 16 (cards in list), 24 (sections in dashboard), 80–96 (landing sections).
Sizes: Button sm 36 / md 44 / lg 52 (min tap target 44). Input 48. Header 72. Dashboard TopBar 64. Sidebar 240 (≥1024). Avatar 40. Icon disc 48 (cards) / 72 (truck circle). Content max-width: landing 1200; dashboard pages 1120, single-form pages 720 centred; auth card 440.

## 5. Component catalogue (props sketch)
Primitives (`components/ui`), owned by D1. All accept `className`.

| Component | Props / variants | Notes |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "outline" \| "ghost" \| "lime" \| "ghost-dark" \| "danger"`; `size: "sm"\|"md"\|"lg"`; `fullWidth`; `loading`; `leadingIcon`/`trailingIcon`; `asChild`/`href` | primary = grad-primary-btn + white; lime = `#B4E799` + green-950 text ("Ship Goods", "Withdraw"); ghost-dark = transparent, 1.5px `rgba(180,231,153,.7)` border, white text ("List a Route"); outline = white bg, border-strong, ink text ("Decline"); secondary = mint-100 bg, green-800 text ("+ Add Stop") |
| `IconButton` | `icon`, `label` (required, aria-label), `variant: "ghost"\|"surface"`, `size` | Back arrow, bell, eye toggle, copy, menu |
| `Input` | `leadingIcon`, `trailingSlot`, `prefix` (e.g. "₹"), `suffix` (e.g. "/ km", "kg"), `invalid` | 48h, white, 1px border, r-md; leading icon `#2F7D43` 18px |
| `PhoneInput` | `value`, `onChange`, country fixed `+91` | India flag (inline SVG) + "+91" + 1px divider + input; `inputMode="numeric"`, `autocomplete="tel-national"`, maxLength 10 |
| `PasswordInput` | extends Input; reveal toggle | Leading `LockKeyhole`, trailing `Eye`/`EyeOff` IconButton ("Show password") |
| `FormField` | `label`, `hint`, `error`, `optionalTag`, `children` | Wires `id`, `aria-describedby`, `aria-invalid`; error text `#B42318` 13px + `CircleAlert` |
| `Select` | native `<select>` styled, `options`, `leadingIcon` | Chevron `ChevronDown`; used for kg unit, departure time, vehicle type |
| `DateField` | native `type="date"`, `leadingIcon=Calendar` | Display value formatted "20 Nov, 2025" where read-only |
| `OtpInput` | `length=6`, `value`, `onChange`, `onComplete`, `invalid`, `disabled` | 6 boxes 52×56 (mobile 44×52), r-md, auto-advance, paste-split, backspace-back, `autocomplete="one-time-code"`, group `aria-label="One-time password"` |
| `Card` | `as`, `padding: "sm"\|"md"\|"lg"`, `interactive`, `selected`, `tone: "default"\|"muted"\|"cream"` | white, border, r-lg, shadow-card; `selected` = 1.5px `#2F7D43` border + mint glow |
| `Badge` | `tone: "success"\|"info"\|"violet"\|"neutral"\|"warning"\|"paid"`, `size` | Pill, caption 12/600 |
| `Chip` | `label`, `onRemove?`, `variant: "default"\|"add"` | Stop chips "Salem ×"; remove button `aria-label="Remove Salem"` |
| `RadioCard` / `PaymentMethodOption` | `value`, `label`, `description?`, `icon`, `checked` | Row with icon tile, label, radio right; whole row clickable; native radio inside `fieldset` |
| `StatCard` | `icon`, `label`, `value`, `unit?` | White card, icon green-700 in mint disc top-centre, label caption, value amount-md |
| `Spinner`, `Skeleton`, `EmptyState{icon,title,description,action}`, `Modal`, `ConfirmDialog{title,description,confirmLabel,tone}`, `Toast{tone,title,description}` | | Toast bottom-right desktop / top on mobile, `role="status"` (error: `role="alert"`) |
| `Avatar` | `name`, `src?`, `size` | Initials on mint-100 / green-800 text (no portrait assets supplied) |
| `Rating` | `value`, `count?` | Filled `Star` `#F4B524` + "4.8 (124 trips)"; sr text "Rated 4.8 out of 5 from 124 trips" |

Layout / brand (`components/layout`, `components/brand`):
| Component | Props | Notes |
|---|---|---|
| `Logo` | `variant: "light" \| "dark"` (surface it sits on), `size: "sm"\|"md"\|"lg"`, `showWordmark`, `href` | Pin symbol `taki_symbol_transparent.png` + "TAKI" (Montserrat 700, `letter-spacing:.28em`) over "TRAVEL" (Montserrat 600, 0.5em tracking, lime-300 on dark / green-500 on light). On dark: place symbol in a 40px cream (`#F5F5EF`) rounded-12 tile to hide white matte fringe. Wrapper `aria-label="TAKI Travel home"` |
| `SiteHeader` | `transparent` (over hero), `links`, `cta` | Links: How it Works, Benefits, About, Contact (anchor links); "Login" white pill button (green-950 text). Sticky; becomes solid green-950 after 24px scroll |
| `MobileNavDrawer` | `open`, `onClose`, `links` | <768: hamburger `Menu` → right sheet, focus-trap, Esc |
| `AuthLayout` | `title`, `subtitle`, `backHref?`, `children` | Cream page, centred 440 card (r-2xl, shadow-auth), logo top-centre, back `ArrowLeft` top-left, `WaveDecoration` pinned to card bottom. Desktop ≥1024 optional split: left 45% hero photo panel (login_truck_mountain) — lead to decide |
| `WaveDecoration` | `className`, `tone` | Inline SVG, 3 layered paths wave-3→wave-1, height 72–96, `aria-hidden` |
| `DashboardShell` | `nav`, `user`, `children` | ≥1024 fixed 240 sidebar + content; <1024 TopBar + drawer |
| `DashboardSidebar` | `items: {label, href, icon}[]`, `activeHref` | grad-sidebar, Logo(dark), items 44h r-md white/85 text; active = lime-300 pill + green-950 text + `aria-current="page"`; footer: user + "Log out" |
| `TopBar` | `title?`, `onMenu`, `user` | Bell (`IconButton`, badge dot) + Avatar right |
| `PageHeader` | `title`, `count?`, `backHref?`, `subtitle?`, `actions?` | `ArrowLeft` + h2; e.g. "Available Vehicles (3)" |
| `GreetingHeader` | `name`, `subtitle` | "Hi, Arjun 👋" (emoji `aria-hidden`) |
| `DemoBanner` | `children`, `tone` | warning-100 strip with `FlaskConical` icon; used on OTP, login, payment, tracking |

Feature components (owner per architecture §14):
| Component | Key props |
|---|---|
| `HeroSection` | `image`, `eyebrow`, `title`, `subtitle`, `primaryCta`, `secondaryCta` |
| `HowItWorksCard` / `StepItem` | `steps: {icon,title,text}[]` |
| `RoleCard` | `icon`, `title`, `description`, `href`, `selected` |
| `ShipmentSearchForm` | `defaultValues`, `onSubmit` |
| `RouteSummaryBar` | `from`, `to`, `weightKg`, `date` ("Coimbatore → Chennai \| 500 kg \| 20 Nov, 2025") |
| `VehicleCard` | `operator`, `verified`, `rating`, `trips`, `vehicleModel`, `availableKg`, `price`, `badge?`, `image`, `href` |
| `VehicleSummaryCard` | `image`, `operator`, `rating`, `vehicleModel`, `regNo` |
| `RouteMap` | `stops: {name, kind:"origin"\|"stop"\|"destination"}[]`, `caption="Illustrative route"` — inline SVG |
| `RouteStats` | `distanceKm`, `durationHrs`, `stops` |
| `BookingSummary` | `lines: {label, amount}[]`, `total` |
| `PaymentMethodSelector` | `value`, `onChange`, `methods` |
| `StatusTimeline` | `steps: {label, time?, note?, state:"done"\|"current"\|"upcoming"}[]` (`<ol>`, `aria-current="step"`) |
| `BookingIdCopy` | `id` (copy button, toast "Booking ID copied") |
| `EarningsHeroCard` | `label`, `amount`, `deltaPct`, `sparkline` |
| `PayoutCard` | `amount`, `onWithdraw` |
| `EarningsBreakdown` | `rows` (This Month / Last Month / Total Earnings) |
| `SettlementRow` | `bookingId`, `route`, `amount`, `status` |
| `BookingRequestCard` | `from`, `to`, `weightKg`, `date`, `customerName`, `earnings`, `onAccept`, `onDecline`, `status` |
| `PricePreview` | `distanceKm`, `weightKg`, `ratePerKm`, `ratePerKg` |
| `StopChipsInput` | `stops`, `onAdd`, `onRemove` |

## 6. Interaction states
| State | Rule |
|---|---|
| Hover (primary) | Brighten: gradient `#13793F→#0C5E35`; translateY(-1px); shadow-btn grows. Lime: `#A6DE88`. Outline: bg `#F1F3ED`. Cards (`interactive`): shadow-raised + border `#D3D8D2` |
| Active/pressed | translateY(0), shadow none, 4% darker |
| Focus-visible | `ring-focus` on every interactive element (never remove outline); on sidebar/hero use lime ring |
| Disabled | 45% opacity, `cursor:not-allowed`, no shadow; use `aria-disabled` on links |
| Loading | Button keeps width, shows `Spinner` 18px + "Sending…/Verifying…/Processing payment…", `aria-busy`, disabled |
| Invalid | Input border `#B42318`, `aria-invalid`, message below; OTP boxes red border + shake (respect `prefers-reduced-motion`) |
| Selected | Role card / payment row: 1.5px `#2F7D43` border, `#F3F8F1` bg, radio filled green-700 |
| Success | Toast success + inline `CircleCheck` green-600 |
| Empty | `EmptyState` with icon disc (mint-100), title, 1-line help, CTA |
| Skeleton | `#ECEEE8` blocks with 1.2 s shimmer (disabled under reduced motion) |
| Motion | 150–200 ms ease-out for colour/shadow; drawer 240 ms; `prefers-reduced-motion: reduce` → no transforms |

## 7. Responsive rules
| Breakpoint | Rule |
|---|---|
| <640 (`base`) | Single column; full-width buttons; page gutter 16; vehicle cards stack image-left 88px; stat cards 2×2; sidebar → drawer; sticky bottom CTA bar on booking/payment/pricing (safe-area padding) |
| 640–767 (`sm`) | Same as mobile with 24 gutter; auth card centred at 440 |
| 768–1023 (`md`) | Inline site nav; two-column forms (weight/date, travel date/time, capacities); dashboard still drawer + TopBar |
| ≥1024 (`lg`) | Fixed sidebar 240; dashboard content grid 12-col; booking details = map 7 col + summary 5 col; payment = summary + methods side-by-side |
| ≥1280 (`xl`) | Max widths apply; landing hero 640–720px tall |
No horizontal scroll at 360px. Touch targets ≥44×44. Text never below 12px.

## 8. Iconography (lucide-react, stroke 1.75–2, 20px default)
| UI element | Icon |
|---|---|
| Back | `ArrowLeft` |
| CTA arrow | `ArrowRight` |
| Route separator in text | `ArrowRight` 14px (`aria-hidden`; sr "to") — render "Coimbatore → Chennai" with visually-hidden "to" |
| How it works | `Search`, `Truck`, `Package` |
| Role cards | Customer `Package`; Driver `Truck` |
| Customer sidebar | Home `House`, My Shipments `Package`, Payments `Wallet`, Profile `UserRound` (board shows a help-circle — treat as mock error) |
| Driver sidebar | Dashboard `House`, My Routes `Route`, Booking Requests `ClipboardList`, Earnings `IndianRupee`, Profile `UserRound`, Help `CircleHelp` |
| Top bar | `Bell`, `Menu`, `X`, `LogOut` |
| Location fields | `MapPin` (green-500) |
| Date / time | `Calendar`, `Clock` |
| Selects | `ChevronDown` |
| Password | `LockKeyhole`, `Eye`, `EyeOff`, rule checks `Check` (green-600) / unmet `Circle` (ink-subtle) |
| Verified operator | `BadgeCheck` (fill green-600, white stroke) |
| Rating | `Star` (fill `#F4B524`) |
| Route stats | distance `Route`, duration `Clock`, stops `MapPin` |
| Payment methods | UPI `Smartphone` (no UPI/GPay logos — trademark assets not supplied), Card `CreditCard`, Net Banking `Landmark` |
| Booking ID | `Copy` |
| Timeline | done `CircleCheck` (filled green-700 disc + white check), upcoming `Circle` grey disc with `Check` muted |
| Tracking hero | `Truck` 36px in 72px mint disc |
| View route | `MapPin` / `Map` |
| Driver stats | Active Routes `Waypoints`, Booking Requests `ClipboardList`, Completed Trips `PackageCheck`, Available Capacity `Container` |
| Post / add | `Plus`; chip remove `X` |
| Earnings delta | `TrendingUp` (green) |
| Request card | `Package` in mint disc |
| Settlement row | `ReceiptText` |
| Info note | `Info` |
| Toast | `CircleCheck`, `CircleAlert`, `Info` |
| Demo banner | `FlaskConical` |
| Landing benefits | `ShieldCheck` (Reliable), `Leaf` (Sustainable), `TrendingUp` (Growth), `MapPin` (Location), `Truck`, `Package` — mirrors the kit's "Brand Elements" icon set |
| Contact | `Mail`, `Phone`, `MapPin` |

Icons are decorative (`aria-hidden`) unless they are the only content of a control (then the control has `aria-label`).
