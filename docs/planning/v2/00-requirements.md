# TAKI v2 — Requirements (source of truth for all agents)

Verbatim product brief from the owner, plus decisions made with the owner on 2026-11-13.

## Owner decisions (binding)

| Topic | Decision |
|---|---|
| Backend | **Firebase** — Firestore as the persistent database, accessed **server-side** (Next.js route handlers / server code with `firebase-admin`). Clients never write business data directly. Firebase Auth may be used if it fits; otherwise server sessions. P2 decides and documents. |
| Local dev | **Firebase Emulator Suite** (Firestore, Auth if used, Storage). Owner is installing Java 21 (2026-11-13). No real Firebase project or credentials are needed for dev/test; production config comes from env vars later. No credentials are committed. |
| OTP / SMS | Provider-ready adapter. Server-generated, hashed, expiring, rate-limited OTP. In dev the code is shown on screen, clearly labelled **"Dev OTP"**. Real SMS provider plugs in via env. |
| Payments | Provider-ready adapter. Cashfree sandbox adapter already scaffolded in `src/app/api/payments/cashfree/*`. A dev gateway may exist but a payment is only "succeeded" after a **server-side confirmation** step; never silently auto-succeed. |
| Branching | Work happens on branch `feat/marketplace`. Phase 1 (approval-before-payment customer flow) is committed there (`cc0d69e`). |
| Design source | `references/screens/*.png`, `Reference.jpeg`, and the **current UI**. No video. Preserve TAKI branding and existing components. |

## Product brief (verbatim)

TAKI is a route-based goods transportation marketplace connecting:
- Customers who want to ship small packages.
- Travel agencies that publish vehicle trips.
- Drivers who transport and deliver shipments.

Customers book available space in vehicles already travelling along their desired routes instead of hiring an entire vehicle.

### Design system – 60:30:10
- 60% Light Sage Green: #E7EDE3
- 30% Dark Sage Green: #244F3F
- 10% Coral Orange: #F08065

White cards, subtle shadows, rounded corners, clean typography, consistent icons, professional spacing.

### A. Public Landing Website
Maintain existing structure: 1) Navbar (logo, How It Works, Benefits, About, Contact, Login). 2) Hero with transport background, headline "Your goods. Their route. One smart connection." 3) Description + CTAs Ship Goods / List a Route. 4) How TAKI Works: Find a Route, Choose a Vehicle, Ship with Ease. 5) Benefits for customers and agencies. 6) Supported goods categories with images. 7) Two-sided marketplace section. 8) Contact form. 9) Footer. Maintain identity, improve responsiveness.

### B. Authentication — separate signup/login for three roles
- **Customer:** Name, DOB (18+), phone OTP, password, confirm password.
- **Travel Agency:** Owner name, agency name, district, vehicle count range, states covered (TN, KL, KA, Telangana, AP), phone OTP, Aadhaar/PAN/license document, photo, password.
- **Driver:** Name, phone OTP, driving license, Aadhaar, associated agency, photo, password.
Validation, secure authentication, role-based access, password recovery.

### C. Customer Dashboard (dark green sidebar, light sage workspace)
Nav: Dashboard, New Shipment, My Shipments, Profile.
Dashboard: welcome, active shipments, completed, pending bookings, recent activity, quick Ship Goods.
**New Shipment** — Source: current location or manual; full address, district, pincode, state. Destination: full address, district, pincode, state. Receiver: name, phone. Package: weight, package type, goods description, shipping date, special handling.
**Find Vehicles** — cards: vehicle image/type, agency + driver info, source/destination, route + checkpoints, departure/arrival, available capacity, price estimate, driver rating. Filters: vehicle type, price, date, capacity. Sort: lowest price, highest price, earliest departure, earliest arrival. Only trips matching route order, date, capacity and goods restrictions.
**Vehicle Details** — overview, driver details, driver reviews, agency info, route, restrictions, capacity, cost breakdown (per kg + per km, transparent extra charges).
**Booking & Payment** — submit request; agency approval required; booking summary; payment method + breakdown; configurable provider, sandbox in dev; never mark paid without real confirmation; confirmation only after approval + payment.
**My Shipments** — Pending, Confirmed, Picked Up, In Transit, Delivered, Rejected, Cancelled. Details page: driver, vehicle, receiver, route, tracking timeline, booking details. Tracking: Booking → Confirmation → Pickup → In Transit → Checkpoints → Out for Delivery → Delivered. Real checkpoint events or authorized GPS only; never fabricate live tracking. Cancel only before pickup. Feedback/rating after delivery.
**Profile** — edit details, photo, password; phone change via OTP.

### D. Travel Agency Dashboard (existing sidebar style)
Nav: Dashboard, Vehicles, Drivers, Add Trip, Trips, Bookings, History, Earnings, Profile, Help.
Dashboard: totals (vehicles, drivers), active/upcoming trips, pending bookings, completed shipments, revenue overview, recent activity.
Vehicles: type, registration, photo, max capacity, goods restrictions, specs; edit/remove.
Drivers: name, phone, photo, license, Aadhaar; add/edit/remove; assign to trips; prevent overlapping assignments.
Add Trip: vehicle, driver, max + available capacity, accepted/restricted goods, source/destination, multiple checkpoints with expected timings, departure/arrival date-time, cost per kg + per km, publish or save draft.
Trips: upcoming/active/completed/cancelled; vehicle + driver; route + timings; booked vs remaining capacity.
Bookings: customer + shipment details; accept/reject; notify customer; share driver/vehicle after acceptance; share customer/receiver with driver; reserve capacity atomically.
History: searchable trips, vehicles, drivers, customers, shipments.
Earnings: total, trip-wise, booking-wise, payment history, settlement status, recent transactions. No fabricated records.
Profile: agency details, verification status, phone OTP update, vehicle/driver management.

### E. Driver Application (mobile-first)
Nav: Dashboard, Assigned Shipments, History, Profile.
Dashboard: active trips, pending pickups, in-transit, completed deliveries.
Assigned shipments: customer, receiver, source/destination, package, vehicle/trip, checkpoints.
Actions: confirm pickup, checkpoint arrival/departure, confirm delivery, upload delivery proof, remarks. Every event timestamped and reflected in customer tracking.
History: completed shipments, delivery records. Profile: details, agency, photo, reviews.

### 3. Business workflow
1 Agency registers + verification. 2 Registers vehicles + drivers. 3 Publishes trips (route, capacity, restrictions, timings, pricing). 4 Customer registers, creates shipment. 5 System finds compatible trips. 6 Customer compares, selects. 7 Submits booking request. 8 Agency accepts/rejects. 9 Rejection → customer notified, capacity released. 10 Acceptance → capacity reserved, details shared. 11 Customer pays. 12 Driver confirms pickup. 13 Driver updates checkpoints. 14 Customer tracks. 15 Driver confirms delivery with proof. 16 Customer submits feedback. Booking status consistent across all three roles.

### 4. Database and backend
Persistent models: users + role profiles, agencies, vehicles, drivers, trips, trip checkpoints, shipments, bookings, payments, tracking events, reviews, notifications.
Relationships: agency → vehicles, drivers; vehicle → trips over time; trip → shipments; shipment → booking + tracking events; completed shipment → review.
API contracts, validation, transactions, indexes, authorization. Atomic capacity reservation. Route matching verifies source/destination order, date, capacity, goods restrictions.

### 6. Development rules
1 Inspect before modifying. 2 Preserve branding/prototype design. 3 Don't replace working functionality unnecessarily. 4 No static mock data as a substitute for backend. 5 Every button/form/filter/nav works. 6 Dashboards show role-specific DB records. 7 Secure auth + backend authorization. 8 Protect Aadhaar, licenses, private contacts. 9 Env vars for credentials. 10 Loading/empty/error/success states. 11 No duplicate bookings / capacity conflicts. 12 Consistent status transitions. 13 Responsive mobile. 14 No conflicting edits between agents. 15 Run and test throughout.

### Final acceptance
All three roles work independently; agencies publish trips; customers discover and book matching vehicles; approval + payment correct; capacity safe; drivers update shipments and delivery events; tracking, history, feedback work; dashboards responsive; critical workflow + security tests pass.
