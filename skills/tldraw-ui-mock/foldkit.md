# Clickable mocks in Foldkit

Read this when the project uses Foldkit, or the mock is meant to become a Foldkit app. Its Model, Messages and `update` carry over to the real app. For a throwaway mock, plain inline JS is less work.

The shape doesn't change. The mock is still one self-contained HTML page that `install-clickable.mjs` installs, so every rule in the Clickable section applies. Foldkit's virtual DOM attaches real listeners, so it already passes the inline-handler check.

## Project

Keep a small Vite project next to the board, in the user's project folder:

```
mock/
  src/main.ts      the program, ending in the embed and window.mockScreens
  shell.html       the page around the bundle
  vite.config.ts
  build.sh
```

Install `foldkit`, `effect`, `@effect/platform-browser`, `vite` and `typescript`. Use the `effect` version that `foldkit` lists as a peer dependency.

## Build to one classic script

The shape runs the page's code with `eval`, which can't run modules. Build an IIFE:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: { entry: 'src/main.ts', formats: ['iife'], name: 'Mock', fileName: () => 'mock.js' },
    minify: true,
  },
})
```

Put the CSS in `shell.html` with a `<script>/*BUNDLE*/</script>` placeholder, then inline the bundle:

```sh
# build.sh
cd "$(dirname "$0")" && npx tsc --noEmit -p . && npx vite build && node -e "
const fs = require('fs')
const js = fs.readFileSync('dist/mock.js', 'utf8').replace(/<\/script/gi, '<\\\\/script')
fs.writeFileSync('mock.html', fs.readFileSync('shell.html', 'utf8').replace('/*BUNDLE*/', () => js))"
```

Vite doesn't typecheck, so `tsc` runs first. The bundle is a few hundred KB, which is fine on a local board.

Then install `mock.html` as usual.

## Drive screens through a port

`show()` reaches a screen from outside the app. Declare an inbound port, turn it into a Message with a Subscription, start the program with `Runtime.embed`, and send through the handle:

```ts
const Screen = Schema.Literals(['Cart', 'Payment', 'Declined', 'Paid'])
type Screen = typeof Screen.Type

const ports = { inbound: { screen: Port.inbound(Screen) }, outbound: {} }

const subscriptions = Subscription.make<Model, Message>()(_entry => ({
  host: Port.subscriptionEntry(ports.inbound.screen, screen => Message.ReceivedScreen({ screen })),
}))

const handle = Runtime.embed(Runtime.makeElement({
  Model, init, update, view, subscriptions, ports,
  container: document.getElementById('root')!,
}))

const go = async (screen: Screen) => {
  handle.ports.screen.send(screen)
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

;(window as any).mockScreens = [
  { name: 'Cart' },
  { name: 'Payment', show: () => go('Payment'), states: [{ name: 'Card declined', show: () => go('Declined') }] },
  { name: 'Paid', next: [], show: () => go('Paid') },
]
```

- `ReceivedScreen` exists only for the mock. Keep it, its port and its Subscription apart from the Messages a person triggers, so they're easy to drop when the mock becomes the app.
- For a state that only clicks can reach, such as a filled form, send several values in a row, or give the port a richer Schema.

## Gotchas

- Foldkit replaces its container element, so styles on `#root` are lost. Put page layout on `body` or on the view's own root.
- Leave out `devTools`. The tested mock ran without it, and running it inside the board hasn't been tried.
- Run Story or Scene tests on the mock's `update` before installing if the flow has logic worth checking. See the verification skill's `foldkit.md`.
