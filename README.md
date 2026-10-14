# Emotale

**Little messages. Lasting feelings.**

A digital card creator with a live preview, MongoDB Atlas persistence, and unique
card links, with optional secret-code protection, photos, and built-in stickers. Editing stays in React
memory until you click **Create Card 💌**. Recipients see a short envelope
reveal and the finished card; protected cards first ask for the sender's code.
The finished-card screen offers a small sender preview and easy sharing,
with generic social link previews that keep card contents private.

## One local settings file

Add MongoDB credentials only to **server/.env**: `MONGODB_URI` and
`MONGODB_DB_NAME`. Start both servers with `npm run dev`. No frontend
configuration file is required, and database values are never passed to React.
The creator now has keyboard-accessible occasion, message, and theme shortcuts.

`server/src/frontend-settings.js` reads only the Vite proxy and public-origin
settings from the shared file; it never injects database settings into React.
The redundant `client/.env.example` has been removed. Production and guarded
data-import tooling remain available. Private `.env` files and `.venv` are kept.

Verification for this simplification: 173 backend tests passed (two expected
skips), the production build and JavaScript syntax checks passed, and local
browser checks covered keyboard shortcuts, live previews, mobile layouts,
reduced motion, health/proxy behavior, and blocked HTTP access to `.env` files.
Atlas connectivity and deployment remain pending. There is no configured lint task.

## Emotale branding and cleanup

Emotale uses the tagline **Little messages. Lasting feelings.** Its wordmark,
browser title, favicon, generic social image, and page metadata use the new
name. Blush, lavender, and cream frame the editor and sharing screen; existing
card themes, templates, content, protection, and recipient behavior are preserved.
The health page now identifies MongoDB and explains its connection settings.

The technical folder remains `Card_codex`. The default database name remains
`card_codex` so a branding update cannot select a different database. Existing
`.env` files, database credentials, private media paths, and stored data are
preserved. Example configuration uses placeholders or a local MongoDB URI.

The editable social artwork is `client/brand/share-preview.svg`. Run
`npm run brand:assets` to regenerate the checked-in 1200 × 630
`client/public/share-preview.png`, then `npm run build`. It contains only generic
Emotale branding. The favicon source is `client/src/assets/emotale-mark.svg`;
Vite places it in the existing public assets route.

The cleanup removed only these generated/obsolete local verification files:

| Removed file under `.verification/` | Reason |
| --- | --- |
| `browser-check.cjs` | Superseded Phase 1 check assumes the health page is `/` and omits photo-storage status; current creator and production checks cover health |
| `desktop.png`, `mobile.png` | Outputs of that obsolete Phase 1 check |
| `phase4-failure.png`, `phase8-failure.png` | Stale failure diagnostics from completed regression runs |
| `mongodb-native-8.0.32/server.zip` | Download archive is unused by verification; the extracted executable and license notices are retained |

The remaining MySQL driver, read-only source queries, guarded import scripts,
source SQL migrations, migration documentation, and safety tests are needed
until migration and rollback acceptance are complete. Runtime persistence uses
MongoDB only. All declared dependencies have current imports or script uses;
dependency versions were preserved. Existing verification database directories,
Python `.venv`, and historical regression assets are left in place because their
contents or purpose do not justify deletion.

This workspace has no Git repository, so cleanup uses a pre-edit hash snapshot
and non-secret source backup under `.verification/emotale-before` instead of a
Git diff. No commit, push, or deployment is part of this cleanup. No lint script
or linter configuration currently exists; `npm run lint` reports that limitation.
JavaScript syntax checks and the frontend build supplement the full test suite.

Branding verification passed: 170 backend tests (two existing skips), the Vite
production build, syntax checks for 66 JavaScript files, 10 explicitly isolated
MongoDB checks, real API persistence and protected-photo browser flows over local
HTTPS, and development/preview metadata checks. The isolated Emotale browser
check covers the title, tagline, favicon, MongoDB health copy, creator behavior,
320/375/1280 layouts, and reduced motion. All verification used loopback services;
Atlas connectivity, source-data cutover, and public deployment remain pending.

## Production readiness in Phase 9

The product and creator stay the same. This phase adds strict production
configuration, verified MongoDB TLS, five active database operations and ten
pending requests by default, recorded MongoDB schema setup, production security headers, explicit
browser-origin rules, wider endpoint limits, safe operational logs, and bounded
shutdown. The existing token URLs, secret-code hashing, private photo access,
and generic social previews are preserved.

**Local development:** use just `server/.env` for both frontend and backend. Run
`npm run dev`. The server defaults to local MongoDB if `MONGODB_URI` is unset;
use your Atlas URI in `server/.env` for remote persistence.

**Production:** Express serves the built React app, API, card HTML, and public
preview image on one HTTPS origin behind a reverse proxy. Set
`NODE_ENV=production`, an explicit HTTPS `PUBLIC_APP_ORIGIN`, `MONGODB_URI`,
`MONGODB_DB_NAME`, and the exact trusted proxy addresses. `server/.env.production.example`
is a password-free template. Secrets belong in the server's secret manager or
uncommitted `.env`; no browser API-base/credential variable is required.

The local storage adapter still works for development. It now implements a
checked `write/read/remove/checkAvailability` contract, stays outside public
directories, rejects linked roots/files, and tests private storage availability
without exposing paths. Production local storage requires explicit
`ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` plus an absolute, private, persistent,
backed-up volume path. No object-storage provider has been chosen or implemented.
The contract and remaining provider requirements are documented in the guide.

Use the practical [deployment guide](DEPLOYMENT.md) for Atlas provisioning,
least-privilege setup/runtime users, TLS, environment variables, setup/import,
build/start commands, HTTPS proxy configuration, CORS, media, backups, health,
and single-process limits. The app has not been deployed to or tested on a
hosting provider.

```powershell
# Build/check with build dependencies available.
npm ci --include=optional
npm test
npm run build

# After provisioning Atlas/storage and setting production variables:
# set up collections/indexes before starting the application.
npm run db:migrate
npm run db:check
npm start
```

Run `npm run db:migrate` to create or verify the `cards` collection, validator,
unique indexes, and versioned setup records in `schema_migrations`. Each
`schema_version: 1` card contains its zero to four photo metadata entries in
`media`; one insert saves the complete document atomically. Normal creation
uses no multi-document transaction, separate `card_media` collection, or TTL
deletion. Expiry restricts reads using MongoDB's clock and preserves records.
Setup refuses incompatible existing data and conflicting indexes/checksums;
it does not convert or delete legacy content. The SQL files and any existing
MySQL or referenced MongoDB data remain available for the explicit staging
importers described in [DEPLOYMENT.md](DEPLOYMENT.md#3-build-and-migrate).

The runtime checks the required schema before hashing a code, preparing files,
or inserting a card. It does not install a schema or create missing application
collections automatically. The native `mongodb` driver is already declared;
`mysql2` remains for guarded source import and the rollback acceptance period.
The shared client connects explicitly, retries after a failed connection attempt,
and drains active operations during shutdown. Queueing and execution share the
default 3000 ms operation budget; pending work waits at most 1000 ms.

Health endpoints distinguish process liveness (`/api/health/live`) from database,
required-schema, and private-storage readiness (`/api/health/ready`). `/api/health`
keeps the original response fields and adds storage status; `/health` now shows
a photo-storage row. Public responses and operational logs omit private data,
credentials, database errors, filesystem paths, and stack traces.

## The card creator

Open **http://127.0.0.1:5173** after starting the project. You can:

- Choose any of the 12 occasions.
- Optionally enter a recipient name and card title. A blank title uses the
  occasion's default title; a blank recipient adds no recipient line.
- Write a message, including line breaks. The message is the only required
  content field. The blank preview is a placeholder, not a saved message.
- Choose Romantic, Birthday, Soft / Pastel, Elegant, Dark / Emotional, or
  Celebration. Each changes the card's background, accents, colors, and
  default typography.
- Choose a font, message size, text alignment, and text color. **Theme default**
  restores the selected theme's text color. Explicit font/color choices stay
  selected when you change themes.
- Optionally open **Choose a starter template** for one of six editable
  starting points, or **Background, layout & decorations** for curated design
  choices. Advanced text weight and spacing are under **More text options**.
- Choose a photo arrangement and optional sticker size/rotation. Every extra
  is optional: occasion, message, and theme are enough to create a card.
- See every edit immediately in the preview. On small screens, the **Edit
  card** and **See live preview** shortcuts help you move between them.
- Optionally enable **Protect your card 🔐**. It starts **OFF**. When ON,
  enter an 8–128 character code and optionally add zero, one, or two hints.
  Hints are visible before unlocking; keep the code out of your hints.
- Optionally add up to four JPEG, PNG, or WebP photos. Preview, remove, and
  reorder them before saving. Each file can be up to 5 MiB.
- Optionally add built-in stickers and choose their positions. No photos or
  stickers are required; a words-only card works just as before.
- Click **Create Card 💌** to save the card. The controls are temporarily
  disabled while saving, so the saved card matches what you submitted.
- Copy its link, share through WhatsApp, Email, or X, open the recipient view, or create another card from the
  success screen. If saving fails, your edits remain available to retry.

The **Connection status** link opens the existing Phase 1 check in a new tab
at **http://127.0.0.1:5173/health**, keeping the editor's current state intact.

### How the live preview works

`CardCreator.jsx` keeps one `card` object in **React state** — the page's
current working data. Each control updates one field in that object. React
then passes the updated object to `CardPreview.jsx` and redraws the card.
The preview uses ordinary React text rendering, so typed HTML appears as
text. Editing sends no requests. Submitting sends the current card to
Express. No browser storage is used; refreshing an unsaved editor clears it.

Options and default titles live in `shared/cardOptions.js`, used by both the
editor and backend validation. Small components handle
the occasion, content, theme, and appearance controls. This keeps each file
focused on one job and makes later additions easier to follow.

## Sharing in Phase 8

After saving, **Your card is ready!** shows a small sender snapshot, the
existing `/card/<32-character-token>` URL, and these controls:

- **Copy Link** uses the Clipboard API and changes to **Copied ✓**, with
  **Link copied!** feedback. If access fails or is unavailable, the URL is
  selected; **Select link** selects it again for manual copying.
- **WhatsApp** opens WhatsApp's app/web sharing with an intro and URL.
  You choose the recipient there.
- **Email** opens your configured email application with a subject, intro,
  and URL. The recipient address stays blank; this app collects no addresses.
- **X** opens its public post composer with the intro and URL.
- **Share** appears when native Web Share is supported and accepts the data.
  It opens the device's share dialog from your click. Cancellation and errors
  give friendly feedback; all individual sharing options remain available.
- **Open Card** opens the recipient experience in a new tab.
  **Create another card** starts a blank card.

**Message to send with your link** is editable text limited to 160 characters,
defaulting to “I made something for you 💌”. It never automatically includes
the card message, name, title, hints, photo URLs, or secret code. Editing the
intro does not change the saved card. Parameters are encoded so emoji and
punctuation remain part of the message. Opening a composer does not send it
automatically or access your account.

The small sender preview stays in this tab's React state. It shows a short
excerpt, occasion/theme, and photo count, without fetching or embedding
photos. It receives no code or hints. Photo preview URLs and the sender's
code state still clear after saving. Share a protected card's code separately.

### Social preview strategy

Social crawlers often do not run JavaScript. For `/card/:shareToken`, server
middleware inserts Open Graph and X/Twitter tags into the original HTML.
**All cards use generic preview text**, “Someone made something for you 💌”,
and a decorative 1200 × 630 envelope image. Names, titles, messages, hints,
codes, hashes, private photo URLs, and protected contents never enter metadata.
An unlock cookie never changes this public preview to private content.

The server validates the token and checks availability using the existing
lock-metadata query; it never queries card content or photos for previews.
Missing, deleted, inactive, or expired cards return `404` HTML with unavailable
metadata. Database/network failures return `503` with retry text. Preview
responses use `Cache-Control: no-store`. The React recipient page retains its
existing friendly states and unlock flow.

Development and Vite's local preview use a small middleware and the read-only
`GET /api/share-preview/:shareToken` API. Production Express can serve the
compiled app and the same dynamic HTML from `client/dist`. There is no
framework migration, database change, or new package. Private storage remains
outside static routes. Tags follow the [Open Graph protocol](https://ogp.me/).

**PUBLIC_APP_ORIGIN** in `server/.env` must match the browser's
origin: `http://127.0.0.1:5173` during development, your Vite preview origin
during local build checks, and the site's HTTPS origin when hosted. Use only
protocol, hostname, and optional port, without a path, query, credentials,
or code. Use the same hostname when opening the app so copied and metadata
URLs match. Host/forwarded headers cannot override this trusted setting.
It is public configuration and contains no database credentials.

Email needs a configured mail application; social applications may ask you
to sign in there. Clipboard and Web Share depend on browser permissions and
support. Native sharing usually needs HTTPS, with local-development exceptions;
see the [Web Share API reference](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
Local URLs cannot be fetched by outside social crawlers. After hosting,
inspect real platform previews using the public HTTPS URL. Platforms may cache
older metadata independently; the server always rechecks card availability
when opened. This phase does not deploy the app or verify message delivery.

## Advanced customization in Phase 7

The editor starts with the original simple flow. Native expandable sections
keep templates, backgrounds, card layouts, decorations, and extra typography
out of the way until you want them. All controls update the same live preview.

- **Backgrounds:** theme default, three solids (cream, rose, midnight), two
  gradients (dawn, ocean), and two subtle patterns (dots, linen).
- **Fonts:** theme default, classic serif, modern sans, playful rounded, and
  handwritten. These are system-font stacks with generic fallbacks; no
  external font downloads are needed. Their exact appearance varies by device.
- **Message styling:** left/center/right alignment, 16/20/24 px sizes,
  regular/medium/bold weights, color, and comfortable/airy line spacing.
- **Card layouts:** classic centered, large title, photo + message, photo
  collage, and letter style. Photo layouts fall back to classic centered when
  there are no photos; adding photos activates the chosen layout again.
- **Photo arrangements:** gallery, hero photo with the remaining gallery,
  two-photo split, or stacked memories. Every arrangement retains all selected
  photos, with the existing four-photo limit and private WebP delivery.
- **Stickers:** the existing 14 choices and five positions, now with
  small/medium/large sizes and upright or 15° left/right rotations. Medium
  preserves the earlier default sizes. One sticker per position keeps them
  separate from the message without a drag-and-drop editor.
- **Decorations:** hearts, stars, sparkles, petals, balloons, confetti, fine
  lines, or dots. These are small built-in shapes, hidden from screen readers
  and unable to intercept clicks. They stay static; Phase 6's brief reveal
  remains the recipient animation.

### Templates are editable starting points

**Birthday Celebration**, **Wish You Were Here**, **I'm Sorry**, **Thank You**,
**You Did It!**, and **Just For You** fill ordinary card fields. Applying one
replaces the current occasion, title, message, appearance, and stickers;
the recipient name, selected photos, and protection settings are preserved.
The explanatory text next to the control says this before you apply it.
Every field remains editable afterward. A template is not stored as another
database entity or used to lock the card's design.

### Readable backgrounds and shared rendering

`shared/designOptions.js` contains small named choices. `shared/cardDesign.js`
turns the selected settings into a rendering configuration used by the same
`CardPreview.jsx` in both the creator and recipient. It supplies defaults,
photo-free layout fallbacks, typography, and readable colors.

Custom backgrounds check text contrast against their solid/gradient/pattern
colors. If a chosen ink is too faint, the renderer uses that preset's safe
ink and the editor explains the adjustment. The chosen color stays in the
editor and saved settings. On an existing theme background, a low-contrast
explicit color is preserved with an opaque contrasting reading panel.
The target for message text is at least **4.5:1**, following
[W3C's contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Changing a background never changes the sender's actual words.

Controls have labels, keyboard focus, and native disclosure behavior. Mobile
controls avoid horizontal scrolling, and the existing preview shortcuts
remain available. Reduced motion still shows the recipient card immediately.
No new packages, uploaded decoration code, or external font services were added.

### Configuration, validation, and old cards

The creation API keeps the existing fields and accepts an optional `design`
object with exactly six supported keys. For example:

```json
{
  "occasion": "love",
  "message": "A little note, just for you.",
  "theme": "romantic",
  "font": "serif",
  "fontSize": "medium",
  "alignment": "left",
  "textColor": null,
  "design": {
    "background": "rose",
    "layout": "letter",
    "photoLayout": "hero",
    "textWeight": "medium",
    "lineSpacing": "airy",
    "decorations": "hearts"
  },
  "stickers": [{ "id": "heart", "position": "top-right", "size": "small", "rotation": -15 }]
}
```

Theme remains in its existing field. The `cards.customization` object
stores validated font/size/alignment/color settings, optional stickers,
and optional `design`. Only changed design values are stored; default design,
empty stickers, and default sticker size/rotation are omitted. This avoids
duplicating theme or adding separate template/layout tables. **No migration
is needed for Phase 7.**

Express rejects unsupported values, extra properties, wrong types, arbitrary
CSS/HTML/URLs, sticker sizes outside the three choices, and rotations outside
`-15`, `0`, `15`. Protected content still goes through the same server unlock
and media authorization checks; design details are withheld before unlock.

Older cards with absent/null customization, no `design`, or original
`{id, position}` stickers keep their defaults. Public responses discard unknown
stored fields and use valid defaults for damaged design settings. The frontend
also checks the response and uses the shared safe choices when rendering.
The plain simple-card request and response shapes remain unchanged.

## Saving and opening cards

```text
Create Card -> POST /api/cards -> validate -> save in MongoDB
            <- unique token and /card/token path

Open /card/token -> GET /api/cards/token -> public card fields
                 -> the same renderer used by the live preview
```

The success screen builds the full link from the browser's current address.
For example: `http://127.0.0.1:5173/card/<32-character-token>`. A local link
works on this computer while the servers are running. Sharing with people
on other computers will require hosting in a later step. The recipient view
needs no account. Unprotected cards reveal automatically; protected cards
first show the unlock screen and reveal after successful verification.

Tokens use Node's cryptographic random generator and the collection's unique
constraint. The server retries a rare token collision up to three times.
They are not sequential database IDs.

The server validates every submitted field. Allowed occasions, themes,
fonts, and sizes come from the shared options. Alignment must be left,
center, or right. Text color is a six-digit hex color or `null` for the theme
default. Message text must contain words and be at most 10,000 characters;
titles are at most 200 characters, and recipient names at most 100.

The `customization` object stores validated font/size/alignment/
color settings, optional approved stickers, and the sparse design settings
described above. Arbitrary JSON and server-controlled fields are
rejected. Blank optional titles/names are stored as `null`; default titles
and font/color values are resolved by the renderer rather than duplicated
in the database. No schema migration is needed for Phase 3.

| Endpoint | Purpose | Success |
| --- | --- | --- |
| `POST /api/cards` | Save JSON card values, or multipart card values and photos | `201` with `shareToken` and `cardPath` |
| `GET /api/cards/:shareToken` | Load public/authorized content or unlock hints | `200` with `{ card: ... }` or `{ protection: { enabled: true, hints: [...] } }` |
| `POST /api/cards/:shareToken/unlock` | Verify `{ "code": "..." }` on the server | `200` with `{ card: ... }` after verification |
| `GET /api/cards/:shareToken/media/:mediaId` | Authorize and retrieve one photo through Express | `200` with normalized WebP bytes |
| `GET /api/share-preview/:shareToken` | Read-only generic availability metadata, without card content | `200` with only `title` and `description`; `404` unavailable, `503` retry |
| `GET /api/health` | Compatible backend/database/schema/storage report | `200` when dependencies are available; `503` degraded |
| `GET /api/health/live` | Process liveness without dependency checks | `200` while responding |
| `GET /api/health/ready` | Dependency readiness for monitoring/routing | `200` ready; `503` unavailable |

Invalid card values return `400` with friendly field messages. Missing or
invalid links return `404`. Oversized request bodies return `413`; creation
requires JSON (`415` otherwise). Database failures return a generic `503`.
The public response includes only occasion, title, recipient name, message,
theme, font, message size, alignment, text color, and optional approved stickers
and photo descriptors. Photo descriptors contain only a random ID, API URL,
width, and height. The API never returns database IDs,
timestamps, status, raw customization, secret codes, hashes, or
database errors. MongoDB queries use typed driver filters and explicit public-field projections.

## Optional protection: how it works

Protection is separate from the card's visual settings. When the switch is
OFF, the frontend sends the same card fields as Phase 3, with no protection
object. No code or hints are required. Turning the switch OFF clears any
code and hints already typed. Creating another card also starts OFF.

When ON, `POST /api/cards` additionally accepts:

```json
{
  "protection": {
    "enabled": true,
    "code": "a shared memory",
    "hints": ["Where we first met"]
  }
}
```

This is the optional portion of the request; the usual card fields are
still required. The backend validates the boolean, exact code length, and
up to two hints of at most 200 characters. Blank hints are omitted. Codes
are case-sensitive; spaces are preserved. Unknown protection fields and
browser-supplied hashes are rejected.

```text
Sender's code -> Express -> salted scrypt hash -> MongoDB

Recipient link -> Express -> lock status and public hints only
Entered code -> Express -> verify against hash
                       -> wrong: friendly failure
                       -> correct: public card content -> existing renderer
```

A **hash** is a one-way fingerprint of the code, not a stored copy of it.
Node's built-in asynchronous scrypt uses a different random salt for each
card, so identical codes produce different hashes. The parameters are
N=65536, r=8, p=2, an
[OWASP-listed scrypt configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
Verification uses a timing-safe comparison. The code is sent only in JSON
request bodies; it is never added to URLs, responses, application logs,
preview data, or browser storage. The sender's code state clears after
successful creation. Senders must remember the code and tell the recipient
separately; sharing controls never include the code.

Before successful verification, the GET response contains **no message,
title, recipient name, theme, typography, code, or hash**. The backend reads
lock metadata separately and fetches protected content only after checking
the code. Setting a React flag cannot bypass this server check.

Wrong codes, missing/expired cards, and invalid unlock values share a
generic `401` response. Server failures return a safe `503`. Failed unlocks
are limited to **5 per IP/card and 20 per IP across cards in 15 minutes**.
Successful unlocks do not consume the failed-attempt allowance. A blocked
request returns `429` and a `Retry-After` header; the screen shows a wait
message and temporarily disables retrying. Protected creation is also
limited to 20 requests per IP in 15 minutes to bound expensive hashing.
Unprotected creation keeps its existing behavior.

The recipient sees a short envelope reveal using the existing card renderer,
a screen-reader success announcement, and keyboard focus on the card heading
after the content appears. Reduced-motion settings show the card immediately.
Code inputs conceal the typed code; hints and errors are accessible text.

### Stored protection fields

The card document retains `unlock_code_hash` and `unlock_hints`. A non-null
hash means protection is enabled, so a separate boolean would duplicate that
state. Unprotected cards store `null` in both fields. Protected cards store
only the versioned salted hash and validated hint array (possibly empty).
The guarded importers retain existing hashes and hints without rehashing codes.
The original SQL definitions remain as migration history.

### Unlock sessions in Phase 5

After successful verification, Express now sets an opaque **HttpOnly**,
**SameSite=Strict** cookie scoped to that card's API path for **30 minutes**.
The cookie contains a random access grant, not the code or hash. JavaScript
cannot read it. The browser automatically includes it when fetching the
card's protected photos; Express checks the grant on every request.
Refreshing or reopening the protected card in the same browser works during
that period. A fresh browser, expired grant, changed code hash, or restarted
Express process requires unlocking again. No accounts or localStorage are used.
Cookies use Secure on HTTPS requests and when `NODE_ENV=production`; hosted
production use therefore requires HTTPS.

Access grants and attempt counters are in memory, appropriate for this single local Express
process. They reset on restart and are not shared across server instances.
A future hosted deployment would need shared counters and proxy settings
appropriate to that host. Codes are verified, not used to encrypt the card
database. This phase does not add code recovery or editing protected cards.

## Recipient experience in Phase 6

The loading screen uses a small branded envelope. After the card is fetched
(and unlocked when required), a reusable CSS envelope opens automatically
in **450–620 milliseconds**. **Open now** completes the reveal immediately
and skips every message, photo, and sticker entrance animation too.

The whole message fades in together in 250–380 ms, regardless of its length.
Photos enter once, with a gentle 40 ms stagger; even four photos finish within
480 ms of appearing. Stickers have one small fade/scale entrance. There is
no typing delay, continuous floating, or animation editor in the creator.

| Theme | Recipient atmosphere |
| --- | --- |
| Romantic | Two soft hearts and a gentle entrance |
| Birthday | Eight small confetti pieces and a playful entrance |
| Soft / Pastel | Three drifting petals |
| Elegant | One quiet accent line |
| Dark / Emotional | Two subtle stars and a slower, restrained entrance |
| Celebration | Six quicker confetti pieces |

Occasions gently adjust these effects: Sorry, Get Well Soon, and Farewell
stay restrained; Missing You softens the movement; Love and Anniversary
favor hearts while preserving the quieter Elegant/Dark style. Birthday and
Congratulations add celebration to the bright themes. The sender's selected
theme, text, photos, and stickers still use the same `CardPreview` renderer.

### Accessibility and performance

`useReducedMotion.js` reads the browser's `prefers-reduced-motion` setting
before the reveal renders and watches for changes. With reduced motion,
the card appears immediately and decorative movement is disabled. Turning
the preference on during a reveal completes it; turning it off does not
replay that already opened card. The next card can use the new preference.
This follows the browser's [reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

Open now, unlock, and retry controls work with keyboard and touch, with
visible focus and 44 px minimum button heights. Loading, unlock results,
expired access, and errors have text announcements. Decorative elements
are hidden from screen readers and cannot intercept clicks. The complete
message is ordinary text, including line breaks and any typed HTML.

Animations use a few CSS transforms and opacity changes: at most eight
decorative elements, with finite entrances. No animation packages, canvas,
background video, or new dependencies were added. Photos continue through
the existing optimized WebP pipeline. Mobile layouts are checked at 320,
375, and 430 px portrait widths; the creator and sharing behavior stay intact.

### Loading, errors, and expired access

Invalid, missing, deleted, and unavailable cards get the same friendly
not-found screen. Initial network/server failures offer **Try again** without
showing internal errors. A missing photo has a calm placeholder and
**Retry photo**; the message and remaining photos stay readable.

The recipient checks access when the window regains focus, the document
becomes visible, or a photo fails. Visibility is observed with the browser's
[Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
Checks are bounded, with one request at a time and a short cooldown. A photo
failure during a check queues one follow-up rather than starting a poll loop.
If the server reports expired access, the old card is removed and the neutral
unlock screen explains how to reopen it. A correct code starts the same reveal
again. If a background check has a network failure, the already received card
stays readable with a **Retry connection** notice.

There is no continuous expiry polling or countdown. A card already delivered
to the browser remains readable until a recheck discovers expiry; the server
still rejects every new unauthorized content or media request. Protected
content, themes, and photo URLs are never rendered before authorization.
Phase 6 changes no database tables, API protection rules, or sharing behavior.

## Optional photos and stickers

The **Photos** section uses local object URLs for immediate previews. Moving
a photo up or down changes its saved order. Removing a photo releases its
preview URL; saving successfully or starting another card clears all local
photo state. Nothing uploads until **Create Card** is clicked. A failed save
keeps the draft, including selected photos, available to retry.

With no photos, creation uses the original JSON request. With photos, the
browser sends multipart form data: one `card` field containing the validated
card JSON and up to four `photos` file parts in display order. Do not set a
multipart Content-Type manually: the browser creates its boundary.

```text
Choose photo -> local browser preview
Create Card -> Express receives the file
            -> check size, actual format, dimensions, and full decoding
            -> rotate, resize, strip metadata, re-encode as WebP
            -> private disk file + embedded cards.media metadata in MongoDB
Open card -> Express returns safe photo descriptors after authorization
          -> browser requests each photo -> Express authorizes -> gallery
```

The server accepts still JPEG/PNG/WebP only, at most **four files**, **5 MiB
each**, **12 million pixels**, and **8192 pixels per side**. Original names
and MIME labels cannot prove the file is an image: signatures and the Sharp
decoder inspect the actual bytes. Executables, SVG, GIF, animated images,
and damaged files are rejected. Re-encoding removes EXIF/location metadata,
applies camera orientation, and fits the image within 2400 pixels without
enlarging small images. Multipart uploads are limited to 20 per connection
IP in 15 minutes before parsing, separate from existing code-attempt limits.

`storage/local.js` is a replaceable adapter with `write`, `read`, and
`remove` methods. Local files live in **server/storage/photos**, which is
ignored by Git and never served by `express.static`. Generated random
identifiers become restricted `.webp` filenames; original filenames and
filesystem paths are never returned. Optional `MEDIA_DIRECTORY` can select
a different private absolute folder. A future cloud adapter can implement
the same methods while keeping authorization in Express.

Each card's `media` array stores zero to four media IDs, private storage keys,
MIME types, byte sizes, widths/heights, sort orders, and creation times. Image
bytes stay in private storage, outside MongoDB. A card and all its metadata
save in one atomic document insert. Unique indexes prevent reuse of tokens,
media IDs, and storage keys across cards; validation also rejects duplicate
photo IDs, keys, or order within a card. Run `npm run db:migrate` before saving.
Guarded importers move existing MySQL or referenced MongoDB metadata into a
separate staging database and preserve the existing file keys; they do not
copy or delete private photo bytes.

Definite save failures remove prepared files. If a write result is uncertain,
the repository checks the same private document ID before deciding whether it
saved. An unresolved outcome retains the files for reconciliation and emits
a safe warning, keeping hashes, paths, and private URLs out of responses/logs.

Protected photos have no permanent public storage URL. Their API route
checks that the card is active/unexpired, that the media belongs to it, and
that the browser has a valid card/hash-bound grant. Unauthorized, cross-card,
invalid, and missing photos return a friendly `404`. Authorized image
responses use `private, no-store` and `nosniff`. Before unlocking, the card
response contains no photos, stickers, or other protected customization.
The preview and recipient share `PhotoGallery`; unavailable images show a
small fallback while the rest of the card stays readable.

The **Little extras** section offers 14 built-in emoji stickers. Each of five
positions holds one sticker: top left, top right, center, bottom left, and
bottom right. Add, remove, or change a position using ordinary buttons and
selects. Validated `{ id, position }` selections live in `customization`
JSON. The server accepts only curated IDs and positions, never uploaded
stickers or caller-supplied HTML/SVG. Empty sticker data is omitted.

Local storage needs persistent disk space and backups when hosted. Cloud
storage, an orphan-file sweeper, deletion/editing workflows, and shared
grant/limiter storage are future work. A crash between file writes and a database
commit can leave an orphan; definite failures perform cleanup and uncertain
writes retain files until their outcome can be reconciled. This
phase adds no music, accounts, AI, or advanced editing.

## How the pieces fit together

```text
Health-check page /health (port 5173)
    -> GET /api/health, forwarded by Vite
Express backend (port 3001)
    -> MongoDB ping
MongoDB Atlas (or local MongoDB for development)
```

- **React** builds the page you see in your browser.
- **Vite** runs the frontend development server and builds the frontend.
- **Tailwind CSS and CSS** style the page.
- **Express** receives the frontend's request and returns a small JSON report.
- **MongoDB** stores the database. The backend talks to it; the browser never
  receives your database password.
- The root `package.json` uses **npm workspaces**: one install manages both
  the `client` and `server` packages.

## Requirements

- Node.js **24 or newer**, with npm.
- A MongoDB Atlas cluster (recommended) or local MongoDB server.
- A MongoDB connection URI and database name. The runtime database user needs
  access to the application database; do not share its credentials.

Check the installed tools in PowerShell:

```powershell
node --version
npm --version
mongosh --version
```

The app uses the MongoDB Node.js driver and does not require `mongosh`.

## First-time setup

All commands below run from the project root. On this computer:

```powershell
Set-Location 'D:\B.Tech\Projects\Active\Card_codex'
npm install
```

Create the single local configuration file. This command preserves an existing
`server/.env`, so it is safe to repeat:

```powershell
if (-not (Test-Path 'server\.env')) { Copy-Item 'server\.env.example' 'server\.env' }
```

Open the backend settings:

```powershell
notepad server\.env
```

Set `MONGODB_URI` to your Atlas connection string and `MONGODB_DB_NAME` to
`card_codex`. For local MongoDB, the example URI works without Atlas setup.
Never paste credentials into chat or put them in `client/.env`.

Only `server/.env` is active. `server/.env.example` is a short setup template;
`server/.env.production.example` is a deployment checklist, not an active file.
An existing `client/.env` is preserved but no longer loaded. Move any deliberate
`PUBLIC_APP_ORIGIN` or `API_PROXY_TARGET` customization to `server/.env`.
Vite derives the local API address from `HOST` and `PORT`, so normally no
`API_PROXY_TARGET` is needed. Restart both servers after changing settings.

The development template omits pool tuning and one-time import/test settings.
Their defaults and opt-in instructions remain in [DEPLOYMENT.md](DEPLOYMENT.md).
Existing private environment files are not rewritten or stripped of values.

| File | Variables | What they control |
| --- | --- | --- |
| `server/.env` | `PORT` | Backend port; default `3001` |
| `server/.env` | `MONGODB_URI` | MongoDB Atlas or local MongoDB connection |
| `server/.env` | `MONGODB_DB_NAME` | Application database name |
| `server/.env` | `MONGODB_MAX_POOL_SIZE`, `MONGODB_QUEUE_LIMIT`, timeout variables | Defaults: five active operations, ten pending requests, a 1000 ms queue wait, and a 3000 ms total operation deadline |
| `server/.env` | `MEDIA_DIRECTORY` | Optional private photo folder; defaults to `server/storage/photos` |
| `server/.env` | `PUBLIC_APP_ORIGIN` | Frontend origin; default `http://127.0.0.1:5173` |
| `server/.env` | `API_PROXY_TARGET` | Optional nonlocal proxy override; normally derived from `HOST` and `PORT` |

Keep passwords inside `server/.env`. The `.gitignore` excludes local `.env`
files from Git, while keeping the password-free `.env.example` files. Do not
send your password in chat or place it in the frontend. URL-encode special
characters in the username/password portion of an Atlas connection URI.

Create the collections and indexes, then check them:

```powershell
npm run db:migrate
npm run db:check
```

Expected messages include:

```text
MongoDB collections and indexes are ready.
MongoDB connection successful. Required collections and indexes are available.
```

For first setup, `MONGODB_URI` needs a MongoDB user allowed to create
collections, apply validators, and create indexes. After `db:migrate`, use a
least-privilege `readWrite` runtime user. Setup is safe to repeat for a compatible
database and never deletes card data. Existing referenced photos, incompatible
card documents, TTL indexes, and conflicting definitions require review and a
separate staging migration. Setup records checksums and serializes concurrent
jobs; it never drops conflicting collections or indexes.

## Run the application

From the project root:

```powershell
npm run dev
```

Keep that terminal open. It runs both development servers. Open:

- Frontend: **http://127.0.0.1:5173**
- Backend health report: **http://127.0.0.1:3001/api/health**

The frontend opens the card editor. At `/health`, the connection-check page
should show **Running**, **Reachable**, and **Connected** when MongoDB is
configured. Its **Check again** button sends a new request to the backend.
Use `Ctrl+C` in the terminal to stop both servers.

You can also run the two servers in separate terminals, both from the root:

```powershell
# Terminal 1
npm run dev:server
```

```powershell
# Terminal 2
npm run dev:client
```

These servers listen only on this computer. They are for local development,
not a public deployment.

### Serving the compiled app with Express

For a hosted installation, first follow [DEPLOYMENT.md](DEPLOYMENT.md) to
configure production secrets, Atlas/schema, private persistent storage, and
HTTPS/proxy trust. Then build and start:

```powershell
npm run build
npm start
```

Express serves the editor, `/health`, `/card/:shareToken`, built assets, and
the preview image from the same app. Its default bind address is `127.0.0.1`; a hosting
reverse proxy supplies public HTTPS. Production unlock cookies are Secure
and need HTTPS. Deployment is outside this phase; keep using `npm run dev`
for normal local development.

## Checks

```powershell
npm test
npm run build
npm run db:check
npm run test:db
Invoke-RestMethod 'http://127.0.0.1:3001/api/health'
Invoke-RestMethod 'http://127.0.0.1:5173/api/health'
```

- `npm test` tests health and card endpoints, validation, token uniqueness
  and collisions, public field filtering, MongoDB repository filtering, optional
  protection, real scrypt hashing/verification, public hint filtering,
  content withheld before verification, log privacy, failed-attempt limits
  and reset, safe errors, actual image decoding, private storage, multipart
  limits, metadata stripping, atomic embedded writes, uncertain-write recovery,
  session grants, protected media,
  stickers, advanced design validation/round trips, and contrast/layout
  fallbacks. Portable tests use simulated databases and need no Atlas credentials;
  importer tests verify mapping, dry-run guards, conflicts, and partial-batch
  resume without source or target database writes. Files and image processing
  are real; temporary test directories are cleaned up. The real MongoDB suite
  is skipped unless the explicit test-only variables below are configured.
- `npm run build` compiles React into `client/dist`.
- `npm run db:check` verifies MongoDB and required collections/indexes.
- `npm run test:db` saves two real cards through a temporary Express server,
  checks their MongoDB documents and appearance, confirms distinct tokens, and
  loads each card twice, then checks a protected photo card, sticker metadata,
  unauthorized/authorized image retrieval, and session refresh. It deletes only the new verification records/files it
  creates. It requires `ALLOW_MONGODB_INTEGRATION_TEST=true`, `MONGODB_TEST_URI`,
  and a separate `MONGODB_TEST_DB_NAME` ending `_test`, with its schema already
  installed. It uses temporary private storage and never falls back to runtime
  credentials. Cleanup matches the run's message marker, token, and observed
  document ID; it never drops a database.
- `server/tests/mongodb-integration.test.js` uses the same explicit test variables
  and newly named collections to exercise actual validators/indexes. Cleanup
  removes only its recorded IDs; it leaves unrelated application collections
  and databases intact.
- `npm run db:import:mysql -- --dry-run` and
  `npm run db:import:referenced -- --dry-run` inspect a source and separate target
  without target writes or schema setup. Applying requires `--apply`, explicit
  backup/write-freeze/staging guards, and a prepared target ending `_staging`
  or `_test`. Conflicts stop without overwriting existing documents; checkpoints
  permit an exact matching import to resume. See the deployment guide for the
  full variables and cutover/rollback procedure.
- The two HTTP commands verify the backend directly and through Vite's proxy.
  They require the development servers to be running.

To check the complete browser flow, fill in a card and click **Create Card**.
Check **Copy Link** and **Open Card**, then refresh the recipient page or
open the link in a separate browser session. The saved content and theme
should remain the same. Try an invalid `/card/invalid` link to see the friendly
not-found screen. On the creator, blank or whitespace-only messages cannot
be saved. The existing connection-check page remains at `/health`.

For protection, create a card with the switch ON, try a wrong code, then
enter the correct code. Confirm the original message and theme appear.
Refresh to confirm the grant preserves access, then clear cookies or use a
fresh browser to confirm the protected card locks. Try zero, one, and two
hints, and check the unlock page at a narrow mobile width and with reduced
motion enabled. Leave the switch OFF to check the original direct-open flow.

For the reveal, try **Open now** with Enter or a phone tap, check all six
themes, and enable reduced motion in the operating system or browser tools.
The full message should appear immediately in reduced motion. Test a long
message, zero/one/four photos, and stickers at a narrow portrait width. After
a protected session expires, revisit the tab to see the explanatory unlock
screen. A missing photo should offer a retry without hiding the message.

For Phase 7, keep the optional sections closed and save a simple card first.
Then try each background, font, layout, and photo arrangement. Remove all
photos to check that a photo-based card layout falls back gracefully. Try
sticker sizes/rotations and a template, then edit its message and design.
Save a customized protected card and compare the preview with the recipient
after unlock and refresh. A background that needs a different text color
should show the readability explanation next to the preview.

**Current migration verification:** `npm test` passes **170 tests**, with two
skips: the explicitly gated real database suite and an actual file-symlink fixture
that this Windows account cannot create. Windows junction rejection is tested.
The separately enabled suite passes **10 checks** against disposable local
MongoDB Community **8.0.32**, including strict document validation, binary unique
indexes, database-clock expiry, corrupt protection failing closed, and readiness.
The production build also passes.

`.verification/run-local-mongo.cjs` starts an owned loopback test server and stops
it after testing. Its real API verifier saves and reads plain/protected cards,
photos, and stickers. `.verification/mongo-browser-check.cjs` exercises the actual
MongoDB repository with the built frontend over local HTTPS: save, sharing,
wrong/right unlock, photo authorization, recipient refresh, mobile layouts,
secure cookies, CSP, and health. `.verification/mongo-import-engine.mjs` checks
real staging targets, zero-write dry-runs, interrupted-batch recovery, exact
matching, conflict refusal, and referenced conversion. Its MySQL source is an
injected fixture; no live MySQL source was imported.
`.verification/mongo-runtime-check.mjs` verifies the actual server entry point,
connected readiness, API persistence, private logs, and graceful shutdown with
the real MongoDB client. All ten existing Phase 2–9 browser/Vite/startup
regression commands also pass, without changing frontend code.

These results do not establish Atlas connectivity, production persistence, a
completed source import, or public deployment. Existing real `.env` files and
private photo storage are preserved. The creator/recipient/sharing guides and
the card creation and recipient experiences are preserved.

Browser checks use real Express, Sharp, private disk files, scrypt, cookies,
and rate limits against simulated repositories. Real Atlas access, source-data
cutover, cloud storage, public hosting, physical devices, and actual social
delivery remain to be verified for the deployment. Local production photo
storage requires a durable private volume and explicit opt-in. Grants/rate
limits remain per-process; shared stores are needed before running multiple
replicas. The local QA scripts are `.verification/phase9-check.cjs` and
`.verification/phase9-startup.cjs`.

Phase 8 verification passed: **87 automated tests**, the production build,
and existing Phase 2–7 browser regressions. The 11 new portable tests cover
encoded sharing data, exact token/origin validation, generic metadata privacy,
active/unexpired lookup, safe failures, HTML without JavaScript, trusted origins,
and safe built-asset serving. `.verification/phase8-check.cjs` checks real built
Express pages, protected photo cards, copy feedback/busy/manual fallback,
platform links, native support/cancellation/errors, JavaScript-disabled crawlers,
PNG dimensions, photo authorization, refresh, invalid/expired cards, keyboard
focus, and desktop/320/375/430 px touch layouts. Clipboard/native APIs are
stubbed; platform links are inspected without sending messages. Real Atlas,
physical-device behavior, and actual social-platform delivery remain unverified.
`.verification/phase8-vite-check.mjs` also verifies real development and local
preview HTML, original metadata, generic privacy, safe unavailable/error states,
the public PNG, and the existing API proxy against simulated availability.

Phase 7's **76 backend tests** remain included.
Its 14 added portable tests cover strict design/sticker validation, API round
trips, sparse defaults, old cards, protected design privacy, contrast, and
safe shared rendering defaults. Browser checks run real Express, scrypt,
access grants, private disk files, and Sharp with an in-memory repository.

Phase 7 browser checks cover all twelve occasions, six themes, curated backgrounds,
five font choices, typography, five card layouts with zero/one/four photos,
four photo arrangements, sticker size/position/rotation, decorations, six
editable templates, preview/recipient parity after unlock and refresh,
10,000-character plain-text messages, and desktop/320/375/430 px touch layouts.
They confirm optional controls start collapsed, keyboard disclosure/focus
works, reduced motion is honored, and editing makes no card/upload requests.
Existing regressions also cover saving/copying/sharing, reveal/skip, access
expiry, retry/error screens, photo removal/reordering, WebP storage, private
media authorization, and failed-save cleanup. No JavaScript exceptions or
browser storage leaks were found. Mobile checks use Chrome emulation;
physical phone and other-browser testing remains a manual follow-up.
Local browser scripts and screenshots are in the ignored `.verification`
folder; the portable automated API/security tests are in `server/tests`.

To view the compiled frontend, stop the frontend development server, keep the
backend running in a separate terminal, then run:

```powershell
npm run preview --workspace client -- --host 127.0.0.1 --port 5173 --strictPort
```

Vite preview also forwards `/api` to the backend. It is a local build check,
not a production server.
This command uses the development origin, so the example `PUBLIC_APP_ORIGIN`
continues to match. If you choose a different host/port, update that setting.

## The health endpoint

`GET /api/health` returns HTTP `200` when its MongoDB ping and readiness checks succeed:

```json
{
  "status": "ok",
  "backend": { "status": "running" },
  "database": { "status": "connected" },
  "timestamp": "2026-10-04T12:00:00.000Z"
}
```

If MongoDB cannot be reached, it returns HTTP `503`, `status: "degraded"`, and
`database.status: "unavailable"`. Express keeps running so the frontend can
explain the problem. The response never includes credentials or raw database
errors. Readiness checks required collections and indexes; `db:check` performs
the same verification as an explicit command.

## Important files

Phase 9's main files:

| File | What it does |
| --- | --- |
| `server/src/config-reader.js`, `server/src/config.js` | Validate explicit production settings and load the server environment |
| `server/src/db.js`, `server/src/database-checks.js` | Bounded MongoDB client and connection/schema checks without card data |
| `server/src/database-admission.js`, `server/src/database-client.js` | Limit active/queued work, recover failed connections, and drain safely at shutdown |
| `server/src/card-schema.js`, `server/src/card-queries.js`, `server/src/repositories/cards.js` | Validate documents/indexes, filter eligible cards, and atomically save embedded photo metadata |
| `server/scripts/migration-runner.js`, `server/scripts/migrate.js` | Idempotent collection, validator, and index setup |
| `server/scripts/check-db.js` | Check required collections and indexes safely |
| `server/scripts/import-mysql.js`, `mysql-import-utils.js`, `import-referenced.js` | Read-only dry-runs and guarded staging imports with exact matching/conflict checks |
| `server/src/storage/index.js`, `server/src/storage/local.js` | Provider-neutral contract and private local storage/probes |
| `server/src/security/http.js` | Production CSP/security headers and exact-origin browser rules |
| `server/src/security/request-limits.js` | Creation, public-read, media, and health limits before expensive work |
| `server/src/app.js`, `server/src/routes/cards.js` | Wire hardening and preserve Secure card-scoped unlock grants |
| `server/src/routes/health.js` | Compatible status report plus bounded/cached liveness/readiness checks |
| `server/src/runtime.js`, `server/src/index.js` | Safe startup, built frontend checks, and dependency diagnostics |
| `server/src/logging.js`, `server/src/shutdown.js` | Known-field JSON logs and bounded request/pool draining |
| `server/src/services/cards.js`, `server/src/security/secret-codes.js`, `server/src/security/media-grants.js` | Preserve protection while requiring exact stored identifiers/hash shapes |
| `client/src/features/health/HealthCheckPage.jsx`, `health-check.css` | Show private-storage availability without a product redesign |
| `server/.env.example`, `server/.env.production.example` | Explained development/production configuration templates |
| `server/tests/config.test.js`, `http-security.test.js`, `database-checks.test.js`, `migrations.test.js`, `runtime.test.js`, `storage-contract.test.js` | Portable hardening and regression checks |
| `.verification/phase9-check.cjs`, `.verification/phase9-startup.cjs` | Actual local HTTPS/built frontend/CSP flows and production entry/shutdown checks |
| `package.json`, `.gitignore`, `server/scripts/verify-database.js` | Root commands, private-artifact exclusions, and MongoDB integration verification |
| `README.md`, `DEPLOYMENT.md` | Setup, operational limits, provider-neutral deployment, and remaining work |

Files changed or added for Phase 8:

| File | What it does |
| --- | --- |
| `shared/shareLinks.js` | Validates canonical URLs and encodes platform/native share data |
| `shared/sharePreview.js` | Supplies generic text and inserts escaped social tags into HTML |
| `client/src/features/sharing/CardCreatedPage.jsx` | Success screen, editable intro, copy fallback, and sharing controls |
| `client/src/features/sharing/ShareCardSummary.jsx` | Small sender-only snapshot without photo requests |
| `client/src/features/sharing/card-created.css` | Responsive layout, touch targets, and keyboard focus |
| `client/src/features/creator/CardCreator.jsx` | Passes the local summary after saving and clears codes/photos |
| `client/src/api/cards.js` | Confirms the response token's exact 32-character shape |
| `client/server/sharePreviewPlugin.js` | Real HTML metadata in Vite development and preview |
| `client/vite.config.js` | Connects the middleware to the existing Vite/API proxy setup |
| `client/public/share-preview.png` | Generic public envelope artwork without card content |
| `server/src/routes/share-preview.js` | Read-only generic preview API |
| `server/src/sharing/preview.js` | Availability checks and explicit compiled-frontend routes |
| `server/src/app.js`, `server/src/index.js`, `server/src/config.js` | Register previews and serve the built frontend in production |
| `server/src/validation/cards.js` | Requires exact token length before lookups |
| `server/.env.example` | Explain trusted public origins and production settings |
| `server/tests/share-links.test.js`, `server/tests/share-preview.test.js` | Portable sharing and metadata privacy tests |
| `.verification/phase8-check.cjs` | Local sharing/recipient/mobile verification |
| `.verification/phase8-vite-check.mjs` | Checks actual Vite development and preview HTML/proxy behavior |
| `.verification/phase3-ui.cjs` | Accepts the new Copied ✓ state when retrying copy |
| `README.md` | Sharing, configuration, verification, and limitations |

Files changed or added for Phase 7:

```text
README.md
shared/cardOptions.js
shared/designOptions.js                                          new
shared/cardDesign.js                                             new
client/src/api/cards.js
client/src/features/creator/CardCreator.jsx
client/src/features/creator/AppearanceControls.jsx
client/src/features/creator/DesignControls.jsx                     new
client/src/features/creator/design-controls.css                    new
client/src/features/creator/TemplatePicker.jsx                     new
client/src/features/creator/templates.js                          new
client/src/features/creator/StickersFields.jsx
client/src/features/creator/stickers-fields.css
client/src/features/creator/CardPreview.jsx
client/src/features/creator/card-preview.css
client/src/features/creator/CardDecorations.jsx                    new
client/src/features/creator/card-design.css                        new
client/src/features/creator/PhotoGallery.jsx
client/src/features/creator/photo-gallery.css
client/src/features/recipient/RecipientCardPage.jsx
server/src/validation/cards.js
server/tests/design.test.js                                      new
server/tests/card-design.test.js                                 new
.verification/phase7-check.cjs                                    new local QA
```

Generated `client/dist` files and local verification screenshots also update
during checks; they are ignored build/test artifacts. The project map below
explains the files' jobs, including unchanged foundation files.

```text
client/
  index.html                     Browser entry page
  vite.config.js                 React/Tailwind plugins and API proxy
  src/main.jsx                   Starts React
  src/App.jsx                    Chooses creator, recipient, or health page
  src/api/cards.js               Sends creation/unlock requests and safe errors
  src/styles.css                 Page appearance
  src/features/creator/
    CardCreator.jsx              Card state and editor/preview layout
    cardOptions.js               Occasions, themes, fonts, and defaults
    OccasionPicker.jsx           Occasion controls
    CardContentFields.jsx        Optional name/title and required message
    ThemePicker.jsx              Theme controls
    AppearanceControls.jsx       Font, size, alignment, color, weight, and spacing
    DesignControls.jsx           Optional background, layouts, and decorations
    design-controls.css          Disclosure, template, and design control styling
    TemplatePicker.jsx           Applies an editable starter template
    templates.js                 Six curated ordinary card configurations
    ProtectionFields.jsx         Optional code switch and public hint inputs
    protection-fields.css        Scoped sender protection styling
    PhotosFields.jsx             Optional photo selection/removal/ordering
    usePhotos.js                 Local files and preview URL lifetime
    PhotoGallery.jsx             Shared gallery/hero/split/stacked photo renderer
    StickersFields.jsx           Built-in sticker position, size, and rotation
    CardPreview.jsx              Reusable live card renderer
    card-preview.css             Six card themes
    CardDecorations.jsx          Bounded built-in decorative shapes
    card-design.css              Layout, readable surface, and sticker styles
  src/features/health/
    HealthCheckPage.jsx          Original Phase 1 connection check
    health-check.css             Scoped health-page appearance
  src/features/sharing/
    CardCreatedPage.jsx          Success screen, copy and platform/native sharing
    ShareCardSummary.jsx         Local sender summary without private media requests
    card-created.css             Success-screen appearance
  src/features/recipient/
    RecipientCardPage.jsx        Loads cards, handles access checks and page states
    CardReveal.jsx               Reusable envelope, skip action, and reveal lifecycle
    card-reveal.css              Scoped envelope/content/photo/sticker entrances
    recipientAtmosphere.js       Small theme/occasion effect settings
    useReducedMotion.js          Reads and follows the browser motion preference
    UnlockScreen.jsx             Code form, expired-access notice, and retry countdown
    unlock-screen.css            Scoped unlock-screen styling
    recipient-card.css           Recipient experience and error screens
server/
  .env.example                   Explained backend/database configuration
  src/config.js                  Reads and validates server settings
  src/db.js                      Shared MongoDB Atlas client and database
  src/app.js                     Express application
  src/index.js                   Starts and stops the backend
  src/routes/health.js            Health-check endpoint
  src/routes/cards.js             Creation, public lookup, and unlock endpoints
  src/routes/share-preview.js     Generic public availability metadata
  src/sharing/preview.js          Built frontend and production card HTML
  src/validation/cards.js         Validates content, appearance, codes, and hints
  src/services/cards.js           Hashes/verifies codes and prepares public cards
  src/repositories/cards.js       Atomic embedded persistence and write reconciliation
  src/card-schema.js              Versioned validators and required indexes
  src/card-queries.js             Safe projections and database-clock eligibility
  src/database-admission.js       Bounded active operations and pending requests
  src/database-client.js          Connection recovery and safe shutdown draining
  src/security/secret-codes.js    Salted scrypt hashing and verification
  src/security/unlock-limits.js   Server-side creation/unlock request limits
  src/security/media-grants.js    Short-lived card-specific browser access
  src/media/upload.js            Bounded route-specific multipart parser
  src/media/photos.js            Actual image validation and normalization
  src/storage/local.js           Replaceable private file storage adapter
  db/migrations/001_create_cards.sql
                                 Retained legacy MySQL cards schema
  db/migrations/002_create_card_media.sql
                                 Retained legacy MySQL photo metadata schema
  scripts/migrate.js             Creates collections, validators, and indexes
  scripts/check-db.js             Verifies database and required indexes
  scripts/import-mysql.js         Guarded MySQL-to-staging import; dry-run default
  scripts/import-referenced.js    Guarded referenced-MongoDB-to-staging import
  scripts/mysql-import-utils.js   Lossless mapping and resumable import checks
  scripts/verify-database.js     Explicit disposable MongoDB integration check
  tests/health.test.js            Health endpoint tests
  tests/cards.test.js             Card API and security tests
  tests/protection.test.js        Optional protection and privacy/security tests
  tests/media.test.js             Upload/API/embedded metadata/media access checks
  tests/import-mysql.test.js      Fake-database importer mapping/guard/resume tests
  tests/mongodb-integration.test.js
                                 Explicitly gated real validator/index checks
  tests/photo-storage.test.js     Image decoder and private storage checks
  tests/stickers.test.js          Server-side sticker validation checks
  tests/design.test.js            Design API, compatibility, and protection checks
  tests/card-design.test.js       Shared contrast and safe rendering model checks
shared/cardOptions.js            Shared allowed options and defaults
shared/mediaOptions.js           Photo limits, curated stickers and positions
shared/designOptions.js          Curated design choices and sparse defaults
shared/cardDesign.js             Shared rendering configuration and contrast rules
package.json                     Commands for both packages
package-lock.json                Records the installed dependency versions
.gitignore                       Keeps credentials/build output out of Git
```

Each `schema_version: 1` card contains a private ObjectId, case-sensitive unique
share token, content/customization, protection hash/hints, status, timestamps,
nullable expiry, and zero to four embedded media entries. Photos retain private
storage keys; bytes stay on private disk. There is no new `card_media` collection,
normal multi-document transaction, or TTL deletion.

Imported SQL IDs are private decimal strings on cards and media, preserving
unsigned BIGINT values. MySQL imports retain raw status plus the original
collation's active comparison; reads use that snapshot only while status still
matches its recorded value. Referenced MongoDB imports preserve the card
ObjectId and private former media/parent IDs. Public projections exclude all
legacy IDs/markers, ObjectIds, hashes, and storage keys. Authentication, music,
AI, and scheduled delivery remain future phases.

Routes handle HTTP, validation checks input, services generate tokens, and
repositories contain database operations. These small modules separate the different jobs
without adding a new framework or changing the frontend routing approach.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| MongoDB authentication failure | Check the Atlas database user and `MONGODB_URI` in `server/.env` |
| Server selection timeout | Check Atlas IP access list, network access, and `MONGODB_URI` |
| Missing collections/indexes | Run `npm run db:migrate` |
| Existing data/schema conflicts | Back up and use a separate staging target; setup never converts or drops conflicting data |
| Photo rejected | Use still JPEG/PNG/WebP, at most 5 MiB and 12 MP |
| Photo won't load | Unlock protected cards; check private disk files and directory permissions |
| Sharp native runtime missing | Use `npm install --include=optional` with supported Node.js |
| MongoDB setup denied | Use a setup user with collection/index administration privileges |
| Backend unreachable | Start Express and check `HOST` / `PORT` in `server/.env` (or an explicit `API_PROXY_TARGET` override) |
| Port already in use | Stop the previous server or change backend `PORT` in `server/.env`; Vite derives its target automatically unless overridden |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` in place of `npm`, for example `npm.cmd install` |

Restart the affected development server after changing `.env` settings.

Official references: [Vite](https://vite.dev/guide/),
[Express](https://expressjs.com/en/starter/installing/), and
[MongoDB Node.js driver](https://www.mongodb.com/docs/drivers/node/current/).
Token generation uses [Node's crypto API](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback).
Uploads use [Multer](https://expressjs.com/en/resources/middleware/multer/)
and [Sharp](https://sharp.pixelplumbing.com/), following the validation,
generated-name, and private-storage principles in
[OWASP's upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
