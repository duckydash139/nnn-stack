// Renders HTML screens to images and places them on a board in sequence, five per row.
// Run it again with the full list to swap images in place.
// Usage: node place-screens.mjs --board "Board Name" --size 1440x900 home.html=Home "pay.html#error=Payment error"
import { findBoard, flag, parseSize, screenSlug, upsertScreens, withBrowser } from './lib.mjs'

const args = process.argv.slice(2)
const board = flag(args, '--board')
const size = flag(args, '--size')
const pairs = args
if (!board || !pairs.length) throw new Error('Usage: node place-screens.mjs --board "Board Name" --size 1440x900 page.html=Name ...')
const { width, height } = parseSize(size)

const screens = pairs.map((pair) => {
	const at = pair.lastIndexOf('=')
	if (at === -1) throw new Error(`Expected page.html=Name, got ${pair}`)
	const name = pair.slice(at + 1)
	screenSlug(name)
	return { name, page: pair.slice(0, at) }
})
await withBrowser(async (capture) => {
	for (const screen of screens) ({ src: screen.src } = await capture(screen.page, width, height))
})

const doc = await findBoard(board)
const report = await upsertScreens(doc.id, screens, { width, height })
for (const { name, status } of report.images) console.log(`${name}: ${status}`)
for (const { screen, note } of report.notes) console.log(`check note on ${screen}: ${note}`)
for (const { screen, count } of report.comments ?? []) console.log(`check ${count} open comment(s) on ${screen}`)
console.log(`saved "${board}"`)
console.log(`board file: ${doc.filePath}`)
