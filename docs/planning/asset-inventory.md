# Asset Inventory — TAKI Travel (P1)

Kits: **A** = `TAKI_Website_Images_Original_Logo/TAKI_Website_Assets/` (primary), **B** = `TAKI_website_assets/TAKI_website_assets/` (secondary crops).
Target root: `public/assets/taki/{branding,hero,vehicles,cargo,ui,elements}/`. Keep original file names (lower-case snake case) unless renamed below.

## 0. Synthetic-image caveat (from kit A README — must be honoured)
- All truck and hero photographs are **AI-generated marketing mock-ups**. They are not evidence of a real fleet, vehicle model, loading capacity or availability. Never caption them as "our fleet", "verified vehicle" or with a specific operator's real truck.
- Truck logos on synthetic images may deviate from the real mark. Use the logo files in `branding/` for brand display, never a crop from a photo.
- `ui/route_map_illustration.webp` is a placeholder — not a live map, route or GPS.
- Vehicle listing images in the demo are **representative photos** keyed by vehicle *class*, not by operator. Show a small "Representative image" caption/`title` on vehicle detail; alt text says "Representative photo of a …".
- Real deployments must use owner-uploaded, verified photos and backend-sourced prices/weights.

## 1. Logo decision (lead decision #1)
Board shows a line-art "TK" monogram + "TAKI / TRAVEL" lockup. We use the **user's original pin symbol** + an HTML wordmark:
- Symbol: `A/branding/taki_symbol_transparent.png` (229×262, RGBA, auto-masked from white). On dark surfaces the white matte fringe and the transparent inner circle are visible → render the symbol inside a 40px `#F5F5EF` rounded-12 tile on dark (sidebar, hero header, footer). On light surfaces render directly.
- Wordmark: live text "TAKI" (Montserrat 700, wide tracking) over "TRAVEL" (Montserrat 600, small, wide tracking), lime-300 on dark / green-500 on light — matches the board lockup layout.
- Conflict for lead: brand guide tagline is **"TRAVEL AND AGRICULTURE"** (all logo files contain it); board says **"TRAVEL"**. Recommendation: wordmark "TAKI / TRAVEL" in UI chrome (per board + brief); do not use `taki_logo_transparent.png`/`taki_original_full_logo.png` in the UI because they bake in the other tagline.

## 2. Board element → asset mapping
| Board element (screen) | Kind | Chosen source | Target public path | Notes |
|---|---|---|---|---|
| Header/sidebar/auth logo (all) | raster + text | `A/branding/taki_symbol_transparent.png` | `branding/taki_symbol.png` | See §1. Use `next/image` `width={40} height={46}` (ratio 229:262) |
| Hero background (01) | photo | `A/hero/login_truck_mountain_photo.webp` (1672×941) | `hero/login_truck_mountain_photo.webp` | Closest match: green curtain-side truck on winding mountain road, truck on right, open sky/hills left for text. Overlay `grad-hero-overlay`. `object-position: 65% 60%` desktop, `72% center` mobile |
| Auth optional side panel (02–05, login) | photo | same hero photo | same | Only if lead approves split layout ≥1024 |
| About section image (landing extra) | photo | `A/hero/hero_freight_highway_unbranded.webp` (1672×941) | `hero/hero_freight_highway_unbranded.webp` | Unbranded white truck on highway — safe for overlays |
| Promo/OG image | photo | `A/hero/hero_taki_branded_sunset.webp` | `hero/hero_taki_branded_sunset.webp` | Finished promo art with AI-rendered logo — OG/social only, never next to the real logo |
| — | photo | `A/hero/hero_taki_fleet_mountain.webp` | **do not copy** | Byte-identical duplicate of `vehicles/light_cargo_lorry_taki.webp` (same MD5) |
| Vehicle thumb "Raj Transport · Tata 407" (07, 08) | photo | `A/vehicles/light_cargo_lorry_taki.webp` | `vehicles/light_cargo_lorry_taki.webp` | White cab + green tarpaulin on road — closest to board thumbnails; light-truck class |
| Vehicle thumb "Sree Travels · Eicher Pro" (07) | photo | `A/vehicles/mini_delivery_truck_taki.webp` | `vehicles/mini_delivery_truck_taki.webp` | Small/medium class; road background matches card style |
| Vehicle thumb "Kavin Logistics · Ashok Leyland" (07) | photo | `A/vehicles/large_curtainside_lorry_taki.webp` | `vehicles/large_curtainside_lorry_taki.webp` | Larger class (3,000 kg) |
| Vehicle class images (seed / select options) | photo | `medium_box_truck_generic`, `multi_axle_container_taki`, `green_tarpaulin_truck_taki`, `heavy_freight_lorry_taki`, `medium_cargo_truck_taki` | `vehicles/<same>.webp` | Last three are studio shots on **pure black** background (RGB, no alpha) — use `object-fit: cover` inside a dark tile or avoid in light cards; `heavy_freight` and `medium_cargo` look near-identical |
| Route map (08), "View Route" (10) | illustration | **inline SVG** (`RouteMap` component) | n/a | `ui/route_map_illustration.webp` is only 216×198 (too small, blue route line off-brand). Draw SVG: land `#E3F1DA`, water `#CFE5EE`, white roads, route `#1F7A3A` 5px, green origin pin, red destination pin `#C8322F`, labelled stops; caption "Illustrative route". Optionally keep the webp as a tiny static fallback |
| Auth green wave (02–05) | decoration | **inline SVG** (`WaveDecoration`) | n/a | No green-wave asset exists. Kit B `wave-element.png` is the **orange/purple** brand swoosh with crop artefacts ("ts" text, divider line) — not the board wave |
| Hero "Smart Logistics Marketplace" pill, buttons, badges, cards | CSS | — | — | Pure CSS tokens |
| All UI icons (nav, inputs, how-it-works, stats, timeline, payment methods) | icon | lucide-react | — | Mapping in `ui-design-spec.md` §8. Kit B `brand-icons.png` (885×195 strip with labels) is reference only — reproduce with lucide `MapPin, Truck, Package, ShieldCheck, Leaf, TrendingUp` |
| India flag (03, login) | icon | inline SVG (3 bands + 24-spoke chakra simplified) | — | No asset supplied; emoji flags render inconsistently on Windows |
| UPI / GPay / PhonePe / Paytm logos (09) | brand marks | **not supplied** | — | Use lucide `Smartphone` + text "UPI (GPay, PhonePe, Paytm)". Do not fetch third-party logos |
| User avatars "Arjun", "Ravi" (06, 11) | photo | **not supplied** | — | Use initials `Avatar` (mint-100 bg). Do not use stock/AI faces |
| Tracking truck disc (10), request icons (14), settlement icon (15) | icon | lucide `Truck`, `Package`, `ReceiptText` | — | In mint-100 discs |
| Earnings sparkline (11) | decoration | inline SVG path | — | `aria-hidden`; not real chart data |
| Cargo tiles (landing benefits, optional cargo-type picker) | photo | `A/cargo/cargo_{agriculture,construction,general_goods,industrial}.webp` (~215×159) | `cargo/<same>.webp` | Each has a **baked-in label pill clipped at the bottom** (~bottom 22px). Show with `object-fit: cover; object-position: top` in a container ≤ 136px tall, or crop bottom 24px when copying. Small source — max display width ~216px (1×) |
| Footer/banner (optional) | raster | `A/branding/taki_original_dark_banner.png` (923×299) | `branding/taki_original_dark_banner.png` | Contains "TRAVEL AND AGRICULTURE" tagline — only if lead accepts tagline; otherwise skip |
| Road element (optional decoration) | raster | `B/road-element.png` (330×160) | `elements/road-element.png` | Contains "Supporting Elemen…" heading text in rows 0–16 and a grey rule at x≈321–327 → crop to `(0,30)-(318,160)` before use. Better: redraw as SVG |
| Brand swoosh (optional decoration) | raster | `B/wave-element.png` (275×165) | `elements/brand-swoosh.png` | Crop to `(30,30)-(275,165)` to drop "ts" text and divider. Low-res; decorative only |
| Promo phone (optional About) | raster | `A/ui/promo_mobile_brand.webp` (199×201) | `ui/promo_mobile_brand.webp` | Too small for hero use; ≤ 200px display |

## 3. Favicons / app icons / metadata
| Use | Source | Target |
|---|---|---|
| `favicon.ico` | `B/favicon.ico` | `src/app/favicon.ico` (Next file convention) |
| 32 / 48 / 64 PNG | `A/branding/favicon_{32,48,64}.png` (RGBA) | `public/assets/taki/branding/` + `<link rel=icon sizes>` |
| Apple touch | `A/branding/favicon_180.png` | `src/app/apple-icon.png` |
| PWA icons | `A/branding/favicon_192.png`, `favicon_512.png` | `branding/` (manifest optional) |
| App icon light/dark | `A/branding/taki_app_icon_{light,dark}.png` (512, RGBA) | `branding/` — dark variant usable as square logo tile on dark |
| OG image | `A/hero/hero_taki_branded_sunset.webp` → export 1200×630 JPG | `src/app/opengraph-image.jpg` (lead/D2) |
Kit B app-icon/favicon/logo crops (RGB with white bg) are lower quality duplicates — do not copy except `favicon.ico`.

## 4. Copy list (files to place in `public/assets/taki/`)
```
branding/taki_symbol.png                  <- A/branding/taki_symbol_transparent.png
branding/taki_original_symbol_white.png   <- A/branding/ (white-bg version, for light print/OG)
branding/taki_app_icon_light.png, taki_app_icon_dark.png
branding/favicon_32.png, favicon_48.png, favicon_64.png, favicon_180.png, favicon_192.png, favicon_512.png
hero/login_truck_mountain_photo.webp
hero/hero_freight_highway_unbranded.webp
hero/hero_taki_branded_sunset.webp        (OG/promo only)
vehicles/light_cargo_lorry_taki.webp, mini_delivery_truck_taki.webp, large_curtainside_lorry_taki.webp,
         medium_box_truck_generic.webp, multi_axle_container_taki.webp,
         green_tarpaulin_truck_taki.webp, heavy_freight_lorry_taki.webp, medium_cargo_truck_taki.webp
cargo/cargo_agriculture.webp, cargo_construction.webp, cargo_general_goods.webp, cargo_industrial.webp
ui/route_map_illustration.webp            (fallback only), promo_mobile_brand.webp (optional)
elements/road-element.png, brand-swoosh.png  (cropped, optional)
```
Not copied: `hero_taki_fleet_mountain.webp` (duplicate), `taki_logo_transparent.png` / `taki_original_full_logo.png` (tagline conflict), `brand_palette.png`, `original_uploaded_TAKI_brand_guide.png`, kit B palette/typography/brand-icons/banner/logo crops (reference only).

## 5. Dimensions and rendering
| Asset group | Source size | Display | `next/image` hints |
|---|---|---|---|
| Hero photos | 1672×941 (16:9) | full-bleed 100vw × 560–720 | `fill`, `priority` (hero only), `sizes="100vw"`, quality 75 |
| Vehicles | 1448×1086 (4:3) | card 160×120 desktop / 88×72 mobile; summary 96×72; detail up to 480×360 | `sizes="(min-width:1024px) 160px, 88px"`; `object-fit: cover` |
| Cargo | ~215×159 | ≤ 216×136 | intrinsic width/height; no upscaling |
| Symbol | 229×262 | 32–48 px tall in chrome, 96 on auth/404 | explicit width/height to avoid CLS |

## 6. Alt text
| Asset | Alt |
|---|---|
| Hero photo | `""` (decorative — the H1 carries meaning); if used as content: "Green cargo truck driving along a winding mountain road" |
| Logo symbol | `""` when wordmark text is adjacent (link has `aria-label="TAKI Travel home"`) |
| light_cargo_lorry_taki | "Representative photo of a light cargo truck with a green tarpaulin" |
| mini_delivery_truck_taki | "Representative photo of a small delivery truck" |
| large_curtainside_lorry_taki | "Representative photo of a large curtain-side lorry" |
| medium_box_truck_generic | "Representative photo of a medium box-body truck" |
| multi_axle_container_taki | "Representative photo of a multi-axle container truck" |
| green_tarpaulin / heavy_freight / medium_cargo | "Representative photo of a heavy freight lorry with a green cover" |
| hero_freight_highway_unbranded | "White freight truck on an open highway" |
| cargo_agriculture / construction / general_goods / industrial | "Crates of fresh produce" / "Stacked cement bags at a construction site" / "Boxed goods on pallets in a warehouse" / "Industrial drums on pallets" |
| Route map SVG | `role="img"`, `aria-label="Illustrative route map from Coimbatore to Chennai via Salem and Vellore"` (built from data) |
| Wave, sparkline, swoosh, road | decorative, `aria-hidden="true"` |

## 7. Missing assets (flag to lead)
1. Live/route map imagery → inline SVG illustration labelled "Illustrative route" (decided).
2. Green auth wave → inline SVG (decided).
3. User avatars → initials.
4. UPI / bank / card network logos → generic icons + text.
5. India flag → inline SVG.
6. Vector logo (SVG) → not supplied; raster symbol only (fringe on dark mitigated with a cream tile). Ask brand owner for SVG.
7. No board design for Benefits/About/Contact/footer → built from tokens + brand-element icons, no fabricated statistics.
