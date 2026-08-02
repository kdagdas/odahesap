# OdaHesap — Roommate Household Expense Splitter (PRD)

## Overview
Mobile app (Expo React Native, iOS + Android) that helps roommates in a shared apartment (originally German student flat context) track shared household expenses, split costs fairly, and settle up per period.

- **UI language:** Turkish (Türkçe) — all user-facing text
- **OCR source:** German grocery receipts — parsing logic handles German number format (comma decimal), German merchants (Rewe, Edeka, Aldi, Lidl, Penny, Kaufland), discount lines ("Rabatt"), VAT lines ("MwSt"), etc.

## Tech Stack
- Frontend: Expo SDK 54, React Native, Expo Router (file-based routing), TypeScript
- Backend: FastAPI + Motor (MongoDB async driver), MongoDB Atlas M0 (free tier)
- Auth: own e-mail + password (bcrypt hash, opaque 90-day session tokens in `user_sessions`)
- OCR: Google Gemini Vision via the Generative Language REST API (AI Studio free-tier key)
- Hosting: Render free web service; no dependency on any paid or Emergent service

## Data Model (MongoDB collections)
- `users`: `user_id`, `email` (unique), `name`, `password_hash` (bcrypt — never returned by the API), `picture`, `avatar_id`, `created_at`
- `user_sessions`: `session_token` (unique), `user_id`, `expires_at` (TTL), `created_at`
- `households`: `household_id`, `name`, `invite_code` (unique 6 digit), `created_by`, `member_ids[]`, `current_period_id`, `created_at`
- `periods`: `period_id`, `household_id`, `started_at`, `closed_at`, `status` ("active" | "closed"), optional `final_balances`
- `expenses`: `expense_id`, `household_id`, `period_id`, `added_by`, `target_type` ("self" | "household" | "roommate"), `target_user_id`, `items[]`, `total`, `source` ("manual" | "receipt"), `category`, `merchant`, `notes`, `currency`, `created_at`

## Backend API (prefix `/api`)
- `POST /auth/register` — {email, password, name} → session token (409 if e-mail taken)
- `POST /auth/login` — {email, password} → session token (401 on bad credentials)
- `GET /auth/me`, `POST /auth/logout`, `PATCH /auth/profile`
- `POST /households`, `POST /households/join`, `POST /households/leave`, `GET /households/me`
- `POST /ocr/receipt` — receives base64 image, returns `{ merchant, total, items[] }` parsed by Gemini Vision
- `POST /expenses`, `GET /expenses`, `DELETE /expenses/{id}`
- `GET /balances` — returns per-user net, totals paid, simplified transfers (debt-min algorithm)
- `GET /periods`, `POST /periods/close` — closes current period, snapshots balances, starts new period

## Screens (Expo Router)
- `/login` — e-mail + password, tabbed between "Giriş yap" and "Kayıt ol"
- `/onboarding` — create household or join with 6-digit invite code
- `/(tabs)/panel` — Dashboard: personal net, roommate list w/ totals paid, recent expenses
- `/(tabs)/harcamalar` — Expenses list, filter by member + period, expandable rows w/ item breakdown
- `/(tabs)/tara` — Fiş Tara: camera capture + gallery pick, sends to `/api/ocr/receipt`
- `/(tabs)/denge` — Settle-up: net balances, simplified transfer cards, close-period CTA
- `/review` — OCR review: editable item list w/ category icons, per-item OR bulk 3-way assignment
- `/manual` — Manual expense entry (title, amount, category, target, notes)
- `/settings` — Profile, household info + shareable invite code, member list, leave/logout

## Key Business Rules
1. Each user is in at most one household at a time.
2. A "self" expense is private to the payer.
3. A "roommate" expense is visible to payer + target only.
4. A "household" expense is visible to everyone in the household.
5. Balance calculation:
   - Household expense of amount T paid by P (with N members): P receives (T − T/N), every other member owes T/N.
   - Roommate expense of amount T paid by P for X: X owes P T (not split further).
   - Self expenses do not affect balances.
6. Debt simplification: greedy matching of largest creditor with largest debtor to minimize transfers.
7. Closing a period archives it (with final balances snapshot) and creates a new active period with zero balances.

## Category Icons (local, no product image lookup)
`sut_urunleri` 🥛, `meyve_sebze` 🥕, `et_balik` 🥩, `firin` 🥖, `icecek` 🧃, `atistirmalik` 🍫, `ev_urunleri` 🧴, `diger` 🛒 — auto-detected from German keyword matching in OCR pipeline; user can cycle categories with a tap on the review screen.

## Design
- Palette: warm terracotta (`#C86A53`) + sage green (`#607A65`) on cream (`#FDFDFB`); no blue/indigo/purple.
- Layout: bottom tabs (4), warm dark hero card on dashboard.
- Design guidelines: `/app/design_guidelines.json`.
