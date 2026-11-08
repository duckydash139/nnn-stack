---
name: tldraw-ui-mock
description: Build UI mocks on a tldraw Desktop board and iterate from annotations and comments left on them. Covers wireframes from tldraw shapes, static high-fidelity screens, and clickable HTML mocks that run on the board. Use when someone wants a mock, wireframe, prototype or screen design on a tldraw canvas, wants a clickable UI they can annotate, or asks to read or apply notes and comments on a mock board. Requires the tldraw-offline skill.
---

# tldraw UI mocks

Put a mock on a tldraw Desktop board, let the user mark it up, then read that feedback and change the mock. Read the `tldraw-offline` skill first: it covers the server, `tq`, boards, saving and native shapes. This skill adds the mock routes.

Create boards with `POST /api/docs/create`, and pass the user's project folder as `directory`, because the default is Documents. Keep the `.tldraw` file and every HTML source in the project: a board stores only images or the packaged page, and the source is useless without its board. Both scripts print the board's path, so if a board lives outside the project, tell the user.

When a brief from **writing-expectations** covers the feature, draw from it: one screen or state per journey step, plus each bad case's screen, such as empty, error, or rejected. Use the brief's glossary words in labels. The mock shows how the product looks. It never adds or changes what the brief says the product does. A note that would change behavior goes back to the human as a brief change.

## Pick the route

| The user wants | Route | Result |
|---|---|---|
| Layout or flow, or says "wireframe" | Wireframe | tldraw shapes they can drag |
| Visual design across several screens | Static | One locked image per screen |
| To click through it, or says "prototype" | Clickable | One working page in a custom shape on a "Demo" page, plus Screens and States pages with an image of each screen and state |

If the request doesn't say, use a wireframe for an early idea and a clickable mock for a settled flow. Name the route in your reply so the user can redirect you.

## Wireframe

Draw one frame per screen with native shapes and short real labels. Connect screens with `helpers.createArrowBetweenShapes`. Run `helpers.getLints()`, fix what it reports, then save.

## Static

Build each screen as an HTML page at one size, then place them all in sequence, with the main path first:

```sh
node scripts/place-screens.mjs --board "Board Name" --size 1440x900 home.html=Home pay.html=Payment "pay.html#error=Payment error"
```

The script renders each page at 2x with one Chrome, which needs Node 22 or later, and places a locked image for each, left to right, five per row, with a numbered label. A `#hash` renders another state of the same file, if the page reads `location.hash`.

Run it again with the full list and the same names to swap images. Numbers come from each screen's place in that list, so a partial list renumbers the labels. Names are the identity: a renamed screen becomes a new one. Keep the size the same so notes stay lined up.

## Clickable

Write one self-contained HTML file, then install it:

```sh
node scripts/install-clickable.mjs page.html --board "Board Name" --size 1000x640 --title "Checkout"
```

The script rejects a page that breaks these rules, which come from the app's security policy and from how the shape loads the page:

- All JavaScript sits inline in classic `<script>` tags. Remote scripts and modules are blocked, so bundle libraries in.
- Attach events with `addEventListener`. Inline handlers such as `onclick` and `javascript:` URLs are blocked.
- CSS and images are inline or data URLs. Remote images, fonts and stylesheets load, but need a connection.
- Fit the page to `--size` exactly, with no page scroll. Keep state in memory, because a reload returns the mock to its first screen.

The script runs after the page loads, so call setup code directly. Don't wait for `DOMContentLoaded` or `load`.

To write the mock in Foldkit, read [foldkit.md](foldkit.md).

Declare every screen the user should be able to annotate:

```js
window.mockScreens = [
	{ name: 'Cart', next: ['Paid', 'Payment error'] },
	{ name: 'Paid', next: [], show() { goTo('paid') } },
	{ name: 'Payment error', next: ['Cart'], async show() { await goTo('error') } },
]
```

Each screen renders from a fresh load, so `show()` must reach its state from the first screen, without depending on another screen's `show()`. If the page renders on an animation frame, as most frameworks do, end `show()` by awaiting a frame so the screen is drawn before capture. `show()` has 5 seconds to finish. List the first screen first, with no `show()`. List the main path first, because the Screens page shows the screens in this order. Leave `next` out when a screen leads to the one after it. Otherwise list where it really leads, based on what the mock's controls do, and use `next: []` for a dead end. The page can't discover its states, so add a screen here whenever you add one to the mock.

A step in the flow is a screen. The same screen in another condition is a state, so declare it under its screen:

```js
{ name: 'Payment', show() { goTo('payment') }, states: [
	{ name: 'Card declined', show() { fail('declined') } },
	{ name: 'Processing', show() { pay() } },
] }
```

Capture the states someone has to make a decision about, such as empty, error, success or long content: if a state changes the layout or the wording, list it. Skip hover, focus and short spinners unless they're what's being reviewed. Don't list a state as a screen: it adds a jump label and breaks the sequence.

A state renders from a fresh load, running its screen's `show()` and then its own. Each screen has at most 26 states.

Each install refreshes the board's Screens and States pages with Chrome, so they never go out of date. Tell the user to put feedback about a specific screen or state on those pages, because notes on the live mock can end up over a different screen.

- Screens run left to right, five per row, with numbered labels. There are no arrows, because the order shows the sequence. Screens already on the page never move, so a new screen goes in the first free spot from its place in the order, and its number shows where it belongs.
- A small label under a screen shows only what the order can't: "→ 3 Payment error" for a jump, "End" for a dead end.
- Numbers are display only, so inserting a screen renumbers labels without affecting notes or comments.
- The States page has one section per screen with states, in flow order, labeled 5a, 5b and so on. A screen's label on the Screens page says how many states it has. A section wraps after five, unless another section sits below it. Then it runs on to the right. A new section goes at the bottom, so its place can be out of order.
- A state's identity is its screen plus its name, so renaming either makes a new image. Removed states stay, marked like removed screens.
- Turning a screen into a state creates a new image on the States page. Notes and comments stay on the old screen, now labeled "(no longer in mock)". Read those and tell the user which ones need moving.
- A screen's name is its identity. Installing swaps the image in the same shape, so its position, notes and comments stay. A renamed screen becomes a new one.
- A screen whose pixels didn't change is left alone.
- A screen no longer declared stays on the page, labeled "(no longer in mock)". Its notes stay with it. Delete it only if the user asks.
- A comment placed on a screen's locked image is stored as a page position, so it stays put through a swap but would not follow the screen if someone moved it.
- If the script prints `check note on` or `check open comment(s) on`, that feedback sits on a screen that changed. It keeps its position but may no longer point at the right element. Compare each one with the new screen and tell the user which ones moved out of place.

The page holding the mock is named "Demo", unless the user already gave it a name of their own.

Each board holds one clickable mock. Running the script again replaces it and keeps its position, size and notes. On a board that already has its own `script/config.js`, the script stops, so use a new board.

Tell the user: double-click to use it, Esc or click outside to exit, and Reset in the mock's top corner to return to the first screen. A simulated double-click does not enter the mock, so ask them to check that step by hand.

To test it yourself, enter it with `editor.select(id)`, `editor.setEditingShape(id)`, then `editor.setCurrentTool('select.editing_shape', { target: 'shape', shape })`, in that order. Find the iframe with `document.querySelector('iframe[title="..."]')` and click elements through `contentDocument`.

## Read feedback

Get all of these before you act:

```js
const page = await api.getShapes(doc.id)          // notes, drawings, positions
const comments = await api.getComments(doc.id)    // threads, anchors, resolved state
const shot = await api.getScreenshot(doc.id, { mode: 'window', size: 'large' })
```

`api.getShapes` reads only the page open in the app. A clickable mock's board also has Screens and States pages, so read those with `/exec`:

```js
return ['page:screens', 'page:states']
	.filter((id) => editor.getPage(id))
	.flatMap((id) => [...editor.getPageShapeIds(id)].map((shape) => editor.getShape(shape)))
```

To see one, send `editor.setCurrentPage('page:screens')` or `'page:states'` through `/exec`, take a `canvas` screenshot, then switch back to the page the user was on.

Read `tldraw-offline`'s `comment-threads-read-reply-resolve` recipe before writing to a thread.

- Use the screenshot for arrows and drawings, which have no words, and open the file to look at it.
- Use `mode: 'window'` for a clickable mock. `mode: 'canvas'` draws its first-screen poster, which may not be what the note is about.
- Match each note to what sits under it. On the Screens and States pages, the image under a note is fixed. On the live mock, it can change, so go by what the note names and ask if it stays unclear.

If the user asked what you see, report and stop. If they asked you to apply it, apply it. Either way, report a note marked as a test or addressed to someone else without acting on it.

## Apply feedback

- Wireframe: edit the shapes.
- Static: edit the source and run `place-screens.mjs` with the same names.
- Clickable: edit the source, update `window.mockScreens` if the screens or states changed, and run `install-clickable.mjs`.

Then take a screenshot and check the change. Leave the user's notes in place unless they ask you to remove them. Reply in each thread you handled and resolve it, and leave the rest alone.

## Comments need the owner's yes

The first comment converts a board to a format older tldraw builds can't open, so comments stay off until the owner agrees in the app. If `api.getComments` shows `supported: true` with no threads, your writes are silently reverted. Ask the user to add the first comment with the comment tool. After your first write on a board, read the threads back to confirm it landed.

## Finish

Say which route you used, what you checked and how, and where the source lives. Say so if you only simulated the clicks.
