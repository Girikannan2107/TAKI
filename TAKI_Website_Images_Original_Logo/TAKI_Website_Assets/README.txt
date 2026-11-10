TAKI WEBSITE ASSET KIT — 2026-11-10

SOURCE BRANDING
The logo and symbol files in branding/ are cropped directly from the user-supplied brand guideline PNG, not AI-redrawn. 'transparent' versions use automatic white-background masking and should be visually checked, particularly on dark surfaces. For highest-fidelity dark-background usage, use the exact reference art or obtain source SVG from the brand owner.

COLORS: #173D32 primary | #286B50 secondary | #83B99A accent | #F5F5EF background | #242B29 text
FONTS: Montserrat for headings, Inter for body.

WEBSITE USE
Hero: hero/hero_freight_highway_unbranded.webp (preferred for HTML text and original TAKI logo overlays). hero/hero_taki_branded_sunset.webp is a finished promotional artwork with AI-rendered logo, not an exact trademark asset.
Landing / login visual: hero/login_truck_mountain_photo.webp
Vehicle search listings: vehicles/*.webp; use CSS object-fit:cover or contain as appropriate, do not call generated trucks a verified/real owned fleet.
Cargo tiles: cargo/*.webp
Tracking illustration: ui/route_map_illustration.webp (PLACEHOLDER ONLY; not a live map, route or GPS).
Promo: ui/promo_mobile_brand.webp
Navbar/app icons: branding/*.png

IMPORTANT
Generated truck photographs are synthetic marketing mockups, not evidence of real vehicle ownership, vehicle model, loading capacity or service availability. Brand logos on synthetic trucks may have visual deviations. For accurate real-world fleet listings use owner-uploaded verified photos.
Source user image: branding/original_uploaded_TAKI_brand_guide.png

ANTIGRAVITY INTEGRATION
Copy the folders branding/, hero/, vehicles/, cargo/ and ui/ to your React Vite app's public/assets/taki/ directory.
Example: <img src="/assets/taki/vehicles/mini_delivery_truck_taki.webp" alt="Example mini goods vehicle" />
Use correct, data-backed route prices and weights from the backend. Never hardcode fictional data from a design mockup as live offers.

For accurate visual labeling: medium_box_truck_generic.webp represents a generic box-body truck; multi_axle_container_taki.webp represents a branded container rig. Do not infer exact Tata models or capacity figures from photos.
