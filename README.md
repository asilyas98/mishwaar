# مشوار (Mishwaar)

A Yemen-wide app in Modern Standard Arabic (right-to-left) with three tabs:

- **الحافلات (Buses):** bus depots (فرزات), stations and stops
- **الدراجة النارية (Motorcycles):** motorcycle shops, repair workshops and parts sellers
- **التاكسي (Taxi):** riders request a taxi; registered drivers get notified and the first to accept takes it. Cash payment when they meet.

On every tab people can also **draw roads** that are missing from the map (dashed orange lines). On the bus and motorcycle tabs they can **add places** by tapping the map, and rate places 1–5 stars. The app installs as a PWA and works offline (the taxi tab needs internet).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # outputs dist/
```

## Build the iOS app

This project includes a native Capacitor iOS shell (`ios/App/App.xcodeproj`) using bundle ID `com.simpleai.mishwaar` and iOS 15 or later. The app is named **Mishwaar** on the iPhone home screen.

The Mishwaar route-pin logo is included at `public/mishwaar-logo.png`. The matching square app icon is used for the web/PWA icons and the iOS App Store icon.

### Build locally on a Mac

1. Install Node.js 22 or later and Xcode 16 or later.
2. Run `npm ci`.
3. Run `npm run sync:ios` to build the web app and copy it into the iOS project.
4. Open `ios/App/App.xcworkspace` in Xcode, select the `App` target, choose your Apple Developer team under Signing & Capabilities, then archive and distribute to App Store Connect.

The bundle ID is `com.simpleai.mishwaar`; change it in `capacitor.config.json` and the Xcode target before creating the app record if you need a different ID. The included location permission string explains that location is used for nearby stops and taxi pickup.

### Build with Codemagic

The included `codemagic.yaml` builds a signed IPA and uploads it to TestFlight. In Codemagic, set up the App Store Connect integration named `Codemagic` (or change the YAML integration name to match your Codemagic integration), add your App Store distribution certificate and provisioning profile for `com.simpleai.mishwaar`, and create an environment group named `mishwaar_app`.

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (optional; add them to enable shared accounts and rides)
- `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION` (optional; add them if you use a dedicated tile provider)

Add the App Store distribution certificate and provisioning profile for `com.simpleai.mishwaar`, and create an App Store Connect app record with that bundle ID. The workflow uploads to TestFlight only; submit the version for App Review from App Store Connect after completing the store listing, age rating, privacy details, support URL, and review information.

### iOS feature notes

- Location is requested only while the app is in use.
- Taxi push notifications currently use the web push implementation. Background push delivery inside the native iOS app requires an APNs / native push setup before launch; in-app ride updates continue to work while the app is open.
- Supabase credentials are optional for demo mode. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the build environment for shared accounts, rides, and ratings. Do not put the Supabase service role key in the iOS app.

With no `.env`, the app runs in **demo mode**: accounts, ratings, places, roads and taxi rides stay in that browser. The `dist/` folder in the zip is a demo-mode build, so you can drag it straight onto Netlify to try it.

**Trying the taxi in demo mode:** open the site in two tabs of the same browser. In one tab sign up as a rider (مستخدم / راكب); in the other, sign out and sign up as a driver (سائق تاكسي). Demo drivers are approved straight away. Request in one tab, accept in the other.

## Connect Supabase (real accounts and shared ratings)

1. Create a new Supabase project for Mishwaar.
2. Run `supabase/schema.sql` in the SQL editor.
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. On Netlify, add them as environment variables.
4. Optional: under Auth → Providers → Email, turn off "Confirm email" if you don't want people to confirm by email before signing in.
5. **Approve drivers:** new drivers start as `pending`. Check their ID or passport photo in Storage → `driver-docs`, then set `status` to `approved` (or `rejected`) in Table editor → `drivers`.

## Taxi: how it works

| Step | What happens |
|---|---|
| Sign up | Choose rider or taxi driver. Drivers then add car details, plate, and a photo of their national ID card or passport (private storage, never shown to riders). |
| Driver goes online | Toggle «متاح». Their location is shared with the server so nearby requests reach them. |
| Rider requests | Pickup from GPS or a tap on the map, optional destination and landmark. |
| Drivers are notified | Push notification + chime to approved, online drivers within 25 km. |
| First to accept wins | `accept_ride()` only succeeds while the ride is still open, so two drivers can't both take it. Phone numbers are shared only after this. |
| Chat | Rider and driver message each other in the app. |
| Cancel | Either side can cancel. A driver must give a reason; the rider sees it and the request goes back to other drivers. A rider cancelling ends the request (and the driver sees the reason). |
| They meet | When the driver's GPS is within 60 m of the pickup (or they tap «وصلت إلى الراكب»), both get a notification. Price is agreed and paid in cash. |

All taxi changes go through database functions in `supabase/schema.sql` (`request_ride`, `accept_ride`, `cancel_ride`, `mark_arrived`, `complete_ride`); the tables have no direct write access.

## Push notifications (so drivers get requests with the app closed)

Without this step, notifications still show while the app is open in the background, but not when it's closed.

1. `npx web-push generate-vapid-keys`
2. Set `VITE_VAPID_PUBLIC_KEY` (the public key) for the site build.
3. In Netlify → Environment variables add: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:you@example.com`), `WEBHOOK_SECRET` (any long random string).
4. In Supabase → Database → Webhooks create two webhooks that POST to `https://<your-site>/.netlify/functions/notify` with header `x-webhook-secret: <WEBHOOK_SECRET>`: one on `rides` (INSERT, UPDATE) and one on `ride_messages` (INSERT).
5. Deploy with Git or `netlify deploy --prod` (drag-and-drop of `dist/` doesn't include functions).

On iPhone, push only works after the user adds the app to the home screen (Share → Add to Home Screen).

## Where the data comes from

- **OpenStreetMap:** `public/seed/yemen-osm.json` is a snapshot that ships with the app, so it works on first open with no internet. The current snapshot has 122 places. When online, the app pulls fresh data from the Overpass API (with a fallback mirror) and caches it. Results outside Yemen are dropped with a simplified country outline (`src/data/yemen-shape.js`). To update the bundled snapshot before a release, run `npm run seed`.
- **Community:** signed-in users add places by tapping the map. These go into the `places` table and appear for everyone.

OSM coverage in Yemen is thin outside Sana'a, Aden, Taiz, Mukalla and the Hadramawt valley, so community additions matter.

## Offline behaviour

| What | How |
|---|---|
| App shell, icons, seed data | Precached by the service worker (vite-plugin-pwa) |
| Places and ratings | Cached in IndexedDB. The last copy shows when offline. |
| Map tiles | Every tile you view gets cached (CacheFirst, up to 8,000 tiles / 60 days). **احفظ المنطقة دون إنترنت** saves the visible area plus two closer zoom levels, capped at 400 tiles. |
| Ratings / added places while offline | Queued and sent on reconnect. The header shows how many are waiting. |
| Directions | Online: opens Google Maps directions. Offline: straight-line distance plus compass direction (e.g. "١٫٦ كم باتجاه شرق"). |

**Map tiles:** the app uses `VITE_TILE_URL` if set, then OpenStreetMap, then Esri's street map. If a server is blocked for someone (no tiles load at all), it switches to the next one automatically and remembers the choice. **Before launch**, get a free MapTiler key and set `VITE_TILE_URL=https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY` (restrict the key to your domain). OSM's tile policy doesn't allow bulk prefetching, and the Esri backup is a stopgap. For full-country offline maps, a later step would be a PMTiles/vector file the app downloads once.

## Structure

```
src/
  App.jsx                 tabs, place list/detail, add place, draw roads, offline save
  sw.js                   service worker: offline cache + push notifications
  components/             MapView (Leaflet), AccountScreen, TaxiPanel, DriverSignup, Chat, Stars
  lib/taxi/               taxi backend: remote.js (Supabase) and local.js (demo mode)
  lib/notify.js           push subscription + local notifications
  data/                   categories (tabs + OSM tags), governorates (22), Yemen outline
  lib/                    store (IndexedDB + sync queue), osm, auth, geo, offline tiles
supabase/schema.sql       tables, RLS policies, taxi functions, storage bucket
netlify/functions/notify.mjs   sends push notifications for taxi events
scripts/seed-osm.mjs      refreshes the bundled OSM snapshot
```

## Known gaps

- Governorate is a best guess from the nearest governorate town, not from real admin boundaries.
- Ratings apply to stops, depots and shops. Rating individual bus lines or operators would need a `routes` table.
- Drawn roads sit on top of the map; they don't change the base map or Google Maps directions.
- No rating of drivers or riders yet, and no admin screen (approval happens in the Supabase dashboard).
- No moderation yet for places people add. A `reports` table plus a simple admin view would be the next step.
