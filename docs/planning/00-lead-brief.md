# Lead Brief — TAKI Travel website (read this first)

Written by the Team Lead before Phase 1. All agents start from this shared context.

## Repository state (2026-11-10)
- Empty repo apart from brand assets. No existing frontend code. Not previously a git repo (lead ran `git init`).
- Node 24.20, npm 11.19, Windows 11. Shell: Git Bash / PowerShell.
- Playwright browsers already present in `%LOCALAPPDATA%/ms-playwright`.

## Reference material
- `Reference.jpeg` (1536×1024) — single board with 15 screens. Copy at `references/Reference.jpeg`.
- `references/screens/NN-name.png` — each screen cropped from the board and upscaled 2× (lead made these). Use them for per-screen analysis:
  01-landing, 02-role-selection, 03-mobile-number, 04-verify-otp, 05-create-password,
  06-customer-dashboard, 07-available-vehicles, 08-route-booking-details, 09-payment, 10-track-shipment,
  11-driver-dashboard, 12-add-new-route, 13-set-pricing, 14-booking-requests, 15-earnings.

## Brand asset kits supplied by the user
- `TAKI_Website_Images_Original_Logo/TAKI_Website_Assets/` — **primary kit** (README + asset_manifest.json inside).
  - branding/: original colourful pin logo (`taki_symbol_transparent.png`, `taki_logo_transparent.png`, `taki_original_full_logo.png`), app icons, favicons, brand guide.
  - hero/: `login_truck_mountain_photo.webp` (green TAKI curtain-side truck on a winding mountain road — **closest match to the reference hero**), `hero_freight_highway_unbranded.webp`, `hero_taki_fleet_mountain.webp`, `hero_taki_branded_sunset.webp`.
  - vehicles/: 8 truck photos 1448×1086 (green_tarpaulin_truck_taki, medium_cargo_truck_taki, light_cargo_lorry_taki, large_curtainside_lorry_taki, heavy_freight_lorry_taki, multi_axle_container_taki, mini_delivery_truck_taki, medium_box_truck_generic). README: these are synthetic marketing images — never claim they show a verified real fleet.
  - cargo/, ui/route_map_illustration.webp (placeholder only, not a live map).
- `TAKI_website_assets/TAKI_website_assets/` — secondary crops (wave-element, road-element, brand-icons, palette, typography, favicons).

## Brand tokens from the kit
- Primary `#173D32`, Secondary `#286B50`, Accent `#83B99A`, Background `#F5F5EF`, Text `#242B29`.
- Fonts: **Montserrat** (headings, logo, UI) and **Inter** (body).
- The reference screenshot also shows a pale lime/green active-nav pill and light green badges — derive from the screenshot.

## Lead decisions already taken
1. **Logo**: the reference board shows a line-art monogram; the user supplied a separate folder explicitly named "Original_Logo" with the colourful pin logo. We use the **user's original pin symbol** (`taki_symbol_transparent.png`) + a "TAKI / TRAVEL" wordmark set in Montserrat, matching the reference lockup layout. Document this deviation.
2. **Hero photo**: `hero/login_truck_mountain_photo.webp`, with a left-to-right dark-green gradient overlay for text contrast.
3. **Stack** (repo is empty, so the preferred stack applies): Next.js 16 (App Router, `src/` dir), React 19, TypeScript strict, Tailwind CSS v4, lucide-react, react-hook-form + zod, zustand (persisted to localStorage, clearly labelled demo persistence), Vitest for units, Playwright (+ @axe-core/playwright) for e2e/visual/a11y.
4. Assets will be copied to `public/assets/taki/{branding,hero,vehicles,cargo,ui,elements}/`.
5. Everything runs in **demo mode** without credentials: demo auth adapter (OTP shown on-screen as demo, never claims SMS sent), demo payment adapter (never claims a real transaction), illustrative route map (never presented as live GPS).
6. Units: INR (en-IN grouping, ₹), kg, km, Indian date format (e.g. "20 Nov, 2025"), +91 10-digit mobiles starting 6–9.

## Process
Phase 1 (4 planners) → lead sync gate (`implementation-plan.md`, frozen contracts, file ownership) → Phase 2 (8 developers) → Phase 3 (5 testers) → fix/re-test loop.
