// Shared helpers: talk to the tldraw Desktop server, find a board, render a page with Chrome.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// tq.mjs embeds this install's server.json path, so read it from there.
// Requests use fetch because images are too large for a command-line argument.
function readServer() {
	const tq = join(homedir(), 'skills/tldraw-offline/tq.mjs')
	if (!existsSync(tq)) throw new Error(`${tq} is missing. Install tldraw Desktop's agent skills.`)
	const match = readFileSync(tq, 'utf8').match(/serverJsonPath = expandLeadingEnvVar\("([^"]+)"\)/)
	if (!match) throw new Error(`Cannot find the server path in ${tq}`)
	const path = match[1].replace(/^\$HOME/, homedir()).replace(/^\$APPDATA/, process.env.APPDATA ?? '')
	if (!existsSync(path)) throw new Error('tldraw Desktop is not running')
	return JSON.parse(readFileSync(path, 'utf8'))
}

export async function call(method, path, body) {
	const { port, token } = readServer()
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		method,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const data = await res.json()
	if (!res.ok || data.success === false || data.error) throw new Error(data.error ?? `${path}: HTTP ${res.status}`)
	return data.result
}

export const exec = (docId, code) => call('POST', `/api/doc/${docId}/exec`, { code })

export async function findBoard(name) {
	const docs = await call('POST', '/api/search', { code: `return await api.getDocs()` })
	const doc = docs.find((d) => d.name === name)
	if (!doc) throw new Error(`No open board named "${name}". Open: ${docs.map((d) => d.name).join(', ')}`)
	return doc
}

function chromePath() {
	const found = [
		process.env.CHROME_PATH,
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
	].find((p) => p && existsSync(p))
	if (!found) throw new Error('Chrome not found. Set CHROME_PATH.')
	return found
}

// Starting Chrome is the slow part, so one Chrome takes every capture, one at a time.
// The page runs on virtual time, so timers and animations settle without really waiting.
// Keep this order: pause, navigate, then spend the budget. Paused time must be in place
// before the page loads, or the screenshot never returns. Tabs in parallel can stall too.
const SETTLE_MS = 3000
// Timers run on virtual time but animation frames come in real time, so the budget can
// run out before a frame. A capture that expects a report keeps time moving until it lands.
export const REPORT_WAIT_MS = 5000
const HAS_REPORT = `document.documentElement.hasAttribute('data-mock-report')`
// Finishes animations so a capture never catches one midway. Endless ones hold their first frame.
const SETTLE_PAGE = `for (const animation of document.getAnimations()) {
	try { animation.finish() } catch { animation.pause(); animation.currentTime = 0 }
}
document.documentElement.getAttribute('data-mock-report')`

function pageUrl(page) {
	const [file, hash] = page.split('#')
	if (!existsSync(file)) throw new Error(`No such page: ${file}`)
	return pathToFileURL(file).href + (hash ? `#${hash}` : '')
}

async function connect(profile, chrome) {
	const portFile = join(profile, 'DevToolsActivePort')
	for (let i = 0; !existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n'); i++) {
		if (i === 300 || chrome.exitCode !== null) throw new Error('Chrome did not start')
		await new Promise((r) => setTimeout(r, 50))
	}
	const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
	const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
	await new Promise((resolve, reject) => {
		socket.onopen = resolve
		socket.onerror = () => reject(new Error('Could not connect to Chrome'))
	})
	return socket
}

function devtools(socket) {
	let nextId = 0
	const replies = new Map()
	const waiters = new Map()
	socket.onmessage = ({ data }) => {
		const message = JSON.parse(data)
		const reply = replies.get(message.id)
		if (reply) {
			replies.delete(message.id)
			if (message.error) reply.reject(new Error(message.error.message))
			else reply.resolve(message.result)
		}
		const key = `${message.sessionId}:${message.method}`
		waiters.get(key)?.()
		waiters.delete(key)
	}
	return {
		send(method, params = {}, sessionId) {
			const id = ++nextId
			socket.send(JSON.stringify({ id, method, params, sessionId }))
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`Chrome did not answer ${method}`)), 30000)
				replies.set(id, {
					resolve: (value) => (clearTimeout(timer), resolve(value)),
					reject: (error) => (clearTimeout(timer), reject(error)),
				})
			})
		},
		waitFor(sessionId, method) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`Chrome timed out waiting for ${method}`)), 30000)
				waiters.set(`${sessionId}:${method}`, () => (clearTimeout(timer), resolve()))
			})
		},
	}
}

// Calls run with capture(page, width, height, { report }), which returns the page's image
// and any report it left in data-mock-report. Pass report: true when the page will leave
// one, to wait up to REPORT_WAIT_MS for it. `page` is a path with an optional #hash, so one
// file can render several states. Await each capture before starting the next.
export async function withBrowser(run) {
	if (typeof WebSocket === 'undefined') throw new Error('Node 22 or later is needed to capture screens')
	const dir = mkdtempSync(join(tmpdir(), 'ui-mock-'))
	const profile = join(dir, 'profile')
	const chrome = spawn(chromePath(), [
		'--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
		'--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
	], { stdio: 'ignore' })
	const exited = new Promise((resolve) => chrome.once('exit', resolve))
	try {
		const socket = await connect(profile, chrome)
		const { send, waitFor } = devtools(socket)
		const capture = async (page, width, height, { report: expectReport = false } = {}) => {
			const url = pageUrl(page)
			const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
			const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
			try {
				await send('Page.enable', {}, sessionId)
				await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId)
				await send('Emulation.setVirtualTimePolicy', { policy: 'pause' }, sessionId)
				await send('Page.navigate', { url }, sessionId)
				const settled = waitFor(sessionId, 'Emulation.virtualTimeBudgetExpired')
				await send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: SETTLE_MS }, sessionId)
				await settled
				const hasReport = async () => (await send('Runtime.evaluate', { expression: HAS_REPORT, returnByValue: true }, sessionId)).result.value
				const until = Date.now() + REPORT_WAIT_MS
				while (expectReport && Date.now() < until && !(await hasReport())) {
					await send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 100 }, sessionId)
					await new Promise((resolve) => setTimeout(resolve, 50))
				}
				const { result } = await send('Runtime.evaluate', { expression: SETTLE_PAGE, returnByValue: true }, sessionId)
				const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
				return {
					src: `data:image/png;base64,${data}`,
					report: result.value ? JSON.parse(decodeURIComponent(result.value)) : null,
				}
			} finally {
				await send('Target.closeTarget', { targetId })
			}
		}
		const result = await run(capture)
		socket.close()
		return result
	} finally {
		chrome.kill()
		await exited
		// Chrome can still be writing its profile after exit
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
	}
}

export function screenSlug(name) {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
	if (!slug) throw new Error(`Screen name needs letters or numbers: ${name}`)
	return slug
}

// What sits under a screen: only what its position in the sequence doesn't already say.
// No `next` means the following screen, and `next: []` means the flow ends here.
function linkText(screens, i) {
	const { next, states = [] } = screens[i]
	const following = screens[i + 1]?.name
	const parts = !next ? [] : !next.length ? ['End'] : next
		.filter((name) => name !== following)
		.map((name) => `→ ${screens.findIndex((s) => s.name === name) + 1} ${name}`)
	if (states.length) parts.push(`${states.length} state${states.length === 1 ? '' : 's'}`)
	return parts.join('    ')
}

const imageHash = (src) => createHash('sha256').update(src).digest('hex')

// Shared by both pages: switches to the page, then defines how images are swapped,
// how removed ones are marked, and how feedback on changed ones is found. An unchanged
// image is left alone, and a swap keeps the shape, its position and what's attached to it.
function pagePrelude({ width, height, pageId, pageName }) {
	return `
const { AssetRecordType, Box, createShapeId, toRichText } = await import('tldraw')
const w = ${width}, h = ${height}, gapX = 200, gapY = 160, perRow = 5, pageId = ${JSON.stringify(pageId ?? null)}
const REMOVED = ' (no longer in mock)'
const home = editor.getCurrentPageId()
if (pageId && !editor.getPage(pageId)) editor.createPage({ id: pageId, name: ${JSON.stringify(pageName ?? 'Screens')} })
if (pageId) editor.setCurrentPage(pageId)
const report = { images: [], removed: [], notes: [], comments: [], arrowsRemoved: 0 }
const fresh = [], changed = []
const setText = (id, text, meta) => editor.getShape(id) && editor.updateShape({ id, type: 'text', ...(meta ? { meta } : {}), props: { richText: toRichText(text) } })
const isFree = (x, y) => {
	const box = new Box(x, y - 48, w, h + 96)
	return !editor.getCurrentPageShapes().some((s) => s.type !== 'arrow' && box.collides(editor.getShapePageBounds(s)))
}
const syncImage = (id, item, slotFor) => {
	const existing = editor.getShape(id)
	if (existing?.meta.hash === item.hash && existing.props.w === w && existing.props.h === h) {
		report.images.push({ name: item.title, status: 'unchanged' })
		return
	}
	const assetId = AssetRecordType.createId()
	editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', meta: {}, props: { name: item.slug + '.png', src: item.src, w: w * 2, h: h * 2, mimeType: 'image/png', isAnimated: false } }])
	if (existing) {
		const old = existing.props.assetId
		editor.run(() => editor.updateShape({ id, type: 'image', meta: { hash: item.hash }, props: { assetId, w, h } }), { ignoreShapeLock: true })
		if (old) editor.deleteAssets([old])
		changed.push({ id, name: item.title })
		report.images.push({ name: item.title, status: 'swapped' })
	} else {
		editor.createShape({ id, type: 'image', ...slotFor(), meta: { hash: item.hash }, props: { assetId, w, h } })
		fresh.push(id)
		report.images.push({ name: item.title, status: 'placed' })
	}
}
const syncLabel = (id, imageId, item) => {
	const meta = { name: item.name, title: item.title }
	if (editor.getShape(id)) return setText(id, item.label, meta)
	const image = editor.getShape(imageId)
	editor.createShape({ id, type: 'text', x: image.x, y: image.y - 48, meta, props: { richText: toRichText(item.label), size: 'm' } })
}
const markRemoved = (kind, live) => {
	const prefix = 'shape:' + kind + '-'
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'image' || !shape.id.startsWith(prefix) || live.has(shape.id)) continue
		const slug = shape.id.slice(prefix.length)
		const label = editor.getShape(createShapeId(kind + '-label-' + slug))
		const plain = label ? helpers.richTextToPlainText(label.props.richText).replace(REMOVED, '') : slug
		const name = label?.meta.name ?? plain
		if (label) setText(label.id, name + REMOVED, label.meta)
		const link = editor.getShape(createShapeId(kind + '-link-' + slug))
		if (link) editor.deleteShape(link.id)
		report.removed.push(label?.meta.title ?? plain)
	}
}
const isPart = (shape) => shape.id.startsWith('shape:screen-') || shape.id.startsWith('shape:state-')
const joinsImages = (shape) => {
	const bindings = shape.type === 'arrow' ? editor.getBindingsFromShape(shape, 'arrow') : []
	return bindings.length > 0 && bindings.every((b) => b.toId.startsWith('shape:screen-') || b.toId.startsWith('shape:state-'))
}
const reviewChanged = async () => {
	for (const { id, name } of changed) {
		const area = editor.getShapePageBounds(id)
		for (const shape of editor.getCurrentPageShapes()) {
			if (isPart(shape) || joinsImages(shape) || !area.collides(editor.getShapePageBounds(shape))) continue
			report.notes.push({ screen: name, note: shape.props.richText ? helpers.richTextToPlainText(shape.props.richText) : shape.type })
		}
	}
	try {
		const { getLiveCommentThreads } = await import('@tldraw/commenting')
		const threads = getLiveCommentThreads(editor).filter((t) => !t.resolved && t.pageId === editor.getCurrentPageId())
		for (const { id, name } of changed) {
			const area = editor.getShapePageBounds(id)
			// A comment placed on a locked image is stored as a page position
			const onImage = ({ anchor }) => {
				if (anchor.type === 'shape') return anchor.shapeId === id
				if (anchor.type === 'point') return area.containsPoint(anchor)
				if (anchor.type === 'region') return area.collides(anchor)
				return false
			}
			const count = threads.filter(onImage).length
			if (count) report.comments.push({ screen: name, count })
		}
	} catch {
		report.comments = null
	}
}
`
}

const pageEpilogue = `
await helpers.saveDoc()
return report`

// Places or swaps screens in sequence, five per row, keyed by name. A screen already
// on the page never moves. Numbers are display only, so inserting a screen renumbers
// the labels without touching any identity.
// pageId targets another page and creates it if needed; omit it for the current page.
export function upsertScreens(docId, shots, { width, height, pageId, pageName, markRemoved = false }) {
	const screens = shots.map((shot, i) => ({
		name: shot.name,
		title: shot.name,
		src: shot.src,
		slug: screenSlug(shot.name),
		hash: imageHash(shot.src),
		label: `${i + 1} ${shot.name}`,
		link: linkText(shots, i),
	}))
	return exec(docId, `${pagePrelude({ width, height, pageId, pageName })}
const screens = ${JSON.stringify(screens)}
try {
	const screenId = (slug) => createShapeId('screen-' + slug)
	const generated = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow' && s.meta.mockFlow)
	editor.deleteShapes(generated.map((s) => s.id))
	report.arrowsRemoved = generated.length

	const bounds = editor.getCurrentPageBounds()
	const first = editor.getShape(screenId(screens[0].slug))
	const baseX = first ? first.x : bounds ? bounds.maxX + gapX : 0
	const baseY = first ? first.y : bounds ? bounds.minY : 0
	const cell = (n) => ({ x: baseX + (n % perRow) * (w + gapX), y: baseY + Math.floor(n / perRow) * (h + gapY) })
	const slotFor = (start) => {
		let n = start
		while (!isFree(cell(n).x, cell(n).y)) n++
		return cell(n)
	}

	for (const [i, screen] of screens.entries()) {
		const id = screenId(screen.slug)
		syncImage(id, screen, () => slotFor(i))
		syncLabel(createShapeId('screen-label-' + screen.slug), id, screen)
		const shape = editor.getShape(id)
		const linkId = createShapeId('screen-link-' + screen.slug)
		const link = editor.getShape(linkId)
		if (!screen.link) {
			if (link) editor.deleteShape(link.id)
		} else if (link) {
			setText(link.id, screen.link)
		} else {
			editor.createShape({ id: linkId, type: 'text', x: shape.x, y: shape.y + h + 12, props: { richText: toRichText(screen.link), size: 'm', color: 'grey' } })
		}
	}
	editor.updateShapes(fresh.map((id) => ({ id, type: 'image', isLocked: true })))
	if (${markRemoved}) markRemoved('screen', new Set(screens.map((s) => screenId(s.slug))))
	await reviewChanged()
	if (fresh.length && !pageId) editor.zoomToFit()
} finally {
	if (pageId) editor.setCurrentPage(home)
}${pageEpilogue}`)
}

// Keeps the States page in step with the mock: one section per screen with states, in
// flow order. A state's identity is its screen plus its name, so two screens can each
// have an "Error" state. Letters are display only, like the numbers on the Screens page.
export async function upsertStates(docId, shots, { width, height }) {
	const sections = shots
		.map((shot, i) => ({ ...shot, number: i + 1 }))
		.filter((shot) => shot.states?.length)
		.map((shot) => {
			const slug = screenSlug(shot.name)
			return {
				slug,
				label: `${shot.number} ${shot.name}`,
				states: shot.states.map((state, j) => ({
					name: state.name,
					title: `${shot.name} / ${state.name}`,
					src: state.src,
					slug: `${slug}--${screenSlug(state.name)}`,
					hash: imageHash(state.src),
					label: `${shot.number}${String.fromCharCode(97 + j)} ${state.name}`,
				})),
			}
		})
	const pageId = 'page:states'
	if (!sections.length && !(await exec(docId, `return Boolean(editor.getPage('page:states'))`))) return null
	return exec(docId, `${pagePrelude({ width, height, pageId, pageName: 'States' })}
const sections = ${JSON.stringify(sections)}
const HEADER = 110
try {
	const stateId = (slug) => createShapeId('state-' + slug)
	const sectionId = (slug) => createShapeId('state-section-' + slug)
	for (const section of sections) {
		const header = editor.getShape(sectionId(section.slug))
		let originX, originY
		if (header) {
			originX = header.x
			originY = header.y + HEADER
			setText(header.id, section.label)
		} else {
			const bounds = editor.getCurrentPageBounds()
			originX = bounds ? bounds.minX : 0
			originY = bounds ? bounds.maxY + 150 + HEADER : 0
			editor.createShape({ id: sectionId(section.slug), type: 'text', x: originX, y: originY - HEADER, props: { richText: toRichText(section.label), size: 'l' } })
		}
		const at = (col, row) => ({ x: originX + col * (w + gapX), y: originY + row * (h + gapY) })
		// A section wraps after five, unless another section sits below it. Then it runs on to the right.
		const slotFor = () => {
			for (let row = 0; ; row++) {
				for (let col = 0; col < perRow; col++) {
					if (isFree(at(col, row).x, at(col, row).y)) return at(col, row)
				}
				const canWrap = Array.from({ length: perRow }, (_, col) => at(col, row + 1)).every((c) => isFree(c.x, c.y))
				if (canWrap) continue
				for (let col = perRow; ; col++) {
					if (isFree(at(col, row).x, at(col, row).y)) return at(col, row)
				}
			}
		}
		for (const state of section.states) {
			const id = stateId(state.slug)
			syncImage(id, state, slotFor)
			syncLabel(createShapeId('state-label-' + state.slug), id, state)
		}
	}
	editor.updateShapes(fresh.map((id) => ({ id, type: 'image', isLocked: true })))
	markRemoved('state', new Set(sections.flatMap((section) => section.states.map((state) => stateId(state.slug)))))
	const liveSections = new Set(sections.map((section) => sectionId(section.slug)))
	for (const shape of editor.getCurrentPageShapes()) {
		if (!shape.id.startsWith('shape:state-section-') || liveSections.has(shape.id)) continue
		const text = helpers.richTextToPlainText(shape.props.richText)
		if (!text.endsWith(REMOVED)) setText(shape.id, text + REMOVED)
	}
	await reviewChanged()
} finally {
	editor.setCurrentPage(home)
}${pageEpilogue}`)
}

export function parseSize(value) {
	const match = /^(\d+)x(\d+)$/.exec(value ?? '')
	if (!match) throw new Error('--size must look like 1000x640')
	return { width: Number(match[1]), height: Number(match[2]) }
}

export function flag(args, name) {
	const at = args.indexOf(name)
	if (at === -1) return undefined
	return args.splice(at, 2)[1]
}
