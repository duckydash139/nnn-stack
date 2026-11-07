// Puts one self-contained HTML page on a board as a clickable shape, or updates it,
// then refreshes the board's Screens and States pages from what the page declares.
// Usage: node install-clickable.mjs page.html --board "Board Name" --size 1000x640 [--title "Checkout"]
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPORT_WAIT_MS, call, exec, findBoard, flag, parseSize, screenSlug, upsertScreens, upsertStates, withBrowser } from './lib.mjs'

const MARKER = 'tldraw-ui-mock'
const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const board = flag(args, '--board')
const size = flag(args, '--size')
const [page] = args
if (!page || !board) throw new Error('Usage: node install-clickable.mjs page.html --board "Board Name" --size 1000x640 [--title "Checkout"]')
const title = flag(args, '--title') ?? basename(page, '.html')
const { width, height } = parseSize(size)

function splitPage(source) {
	const problems = []
	const warnings = []
	const code = []
	const markup = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attrs, body) => {
		const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
		if (type === 'module') problems.push('<script type="module">: eval cannot run modules, so bundle to a classic script')
		else if (type && !type.includes('javascript')) return tag
		if (/\bsrc\s*=/i.test(attrs)) problems.push(`external script ${attrs.trim()}: bundle it into the page`)
		code.push(body)
		return ''
	})
	const handlers = markup.match(/<[^>]*\son[a-z]+\s*=/gi)
	if (handlers) problems.push(`${handlers.length} inline event handler(s) such as onclick: the app blocks them, so use addEventListener`)
	if (/\bhref\s*=\s*["']?javascript:/i.test(markup)) problems.push('javascript: URL: the app blocks them, so use addEventListener')
	const local = /^(?!data:|https?:|blob:|#|$)/i
	for (const [, url] of markup.matchAll(/<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]*)/gi)) if (local.test(url)) problems.push(`local file ${url}: embed it as a data URL`)
	for (const [tag, url] of markup.matchAll(/<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]*)[^>]*>/gi)) if (/stylesheet/i.test(tag) && local.test(url)) problems.push(`local stylesheet ${url}: inline it in a <style> tag`)
	for (const [, url] of markup.matchAll(/url\(\s*["']?([^"')]*)/gi)) if (local.test(url)) problems.push(`local file ${url} in CSS: embed it as a data URL`)
	const js = code.join('\n;\n')
	if (/DOMContentLoaded|addEventListener\(\s*["']load["']|window\.onload/.test(js)) warnings.push('the page waits for a load event: its script runs after load, so that code only runs if it checks document.readyState first')
	const remote = new Set([...markup.matchAll(/https?:\/\/[^"')\s>]+/g)].map((m) => new URL(m[0]).host))
	if (remote.size) warnings.push(`needs a connection for: ${[...remote].join(', ')}`)
	return { html: markup, js, problems, warnings }
}

const { html, js, problems, warnings } = splitPage(readFileSync(page, 'utf8'))
if (problems.length) {
	console.error(`Fix ${page} first:\n${problems.map((p) => `- ${p}`).join('\n')}`)
	process.exit(1)
}

// Each screen renders from a fresh load: this helper shows it, then reports back.
const SCREEN_RUNNER = `<script>
addEventListener('load', () => setTimeout(async () => {
	const report = (value) => document.documentElement.setAttribute('data-mock-report', encodeURIComponent(JSON.stringify(value)))
	try {
		const list = window.mockScreens
		if (!Array.isArray(list)) return report({ names: [] })
		const params = new URLSearchParams(location.hash.slice(1))
		const at = params.get('mock-screen')
		const state = params.get('mock-state')
		if (at !== null) await list[Number(at)].show?.()
		if (state !== null) await list[Number(at)].states[Number(state)].show?.()
		report({
			names: list.map((screen) => screen.name),
			next: list.map((screen) => screen.next ?? null),
			states: list.map((screen) => (screen.states ?? []).map((item) => item.name)),
		})
	} catch (error) {
		report({ error: String(error) })
	}
}, 50))
</script>`

// Renders before touching the board, so a broken screen leaves the board as it was.
async function renderScreens() {
	const dir = mkdtempSync(join(tmpdir(), 'ui-mock-screens-'))
	try {
		const file = join(dir, 'page.html')
		writeFileSync(file, readFileSync(page, 'utf8') + SCREEN_RUNNER)
		return await withBrowser(async (capture) => {
			const load = async (target, name) => {
				const { src, report } = await capture(target, width, height, { report: true })
				if (!report && name) throw new Error(`"${name}" never finished: its show() didn't resolve within ${REPORT_WAIT_MS / 1000}s`)
				if (!report) throw new Error('The page never finished loading in Chrome')
				return { src, ...report }
			}
			const { src: first, names, next, states, error } = await load(file)
			if (error) throw new Error(`mockScreens failed: ${error}`)
			const slugs = names.map(screenSlug)
			if (new Set(slugs).size !== slugs.length) throw new Error(`Screen names must be unique: ${names.join(', ')}`)
			names.forEach((from, i) => {
				const stateSlugs = states[i].map(screenSlug)
				if (new Set(stateSlugs).size !== stateSlugs.length) throw new Error(`Screen "${from}": state names must be unique: ${states[i].join(', ')}`)
				if (states[i].length > 26) throw new Error(`Screen "${from}" has ${states[i].length} states. The limit is 26, so keep only the ones worth reviewing.`)
				if (next[i] === null) return
				if (!Array.isArray(next[i])) throw new Error(`Screen "${from}": next must be a list of screen names`)
				for (const to of next[i]) {
					if (!names.includes(to)) throw new Error(`Screen "${from}": next names "${to}", which isn't a screen. Screens: ${names.join(', ')}`)
					if (to === from) throw new Error(`Screen "${from}": next can't name the screen itself`)
				}
			})
			const jobs = names.flatMap((name, i) => [
				{ name, target: `${file}#mock-screen=${i}` },
				...states[i].map((stateName, j) => ({ name: `${name} / ${stateName}`, target: `${file}#mock-screen=${i}&mock-state=${j}` })),
			])
			const images = []
			for (const { name, target } of jobs) {
				const { src, error: failed } = await load(target, name)
				if (failed) throw new Error(`"${name}" failed: ${failed}`)
				images.push(src)
			}
			let at = 0
			const shots = names.map((name, i) => ({
				name,
				next: next[i],
				src: images[at++],
				states: states[i].map((stateName) => ({ name: stateName, src: images[at++] })),
			}))
			return { first, shots }
		})
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const { first, shots } = await renderScreens()
if (!shots.length) warnings.push('the page declares no window.mockScreens, so the Screens page was not updated')
for (const [i, shot] of shots.entries()) {
	const twin = shots.find((other, j) => j < i && other.src === shot.src)
	if (twin) warnings.push(`"${shot.name}" renders the same as "${twin.name}": check its show()`)
	for (const state of shot.states) {
		if (state.src === shot.src) warnings.push(`state "${shot.name} / ${state.name}" renders the same as its screen: check its show()`)
	}
}

const doc = await findBoard(board)
const { scriptDir } = await call('POST', `/api/doc/${doc.id}/script-workspace`)
const configPath = join(scriptDir, 'config.js')
if (existsSync(configPath)) {
	const config = readFileSync(configPath, 'utf8')
	if (!config.includes(MARKER) && /shapeUtils|bindingUtils|overrides|components/.test(config)) {
		console.error(`"${board}" already has its own script/config.js. Merge assets/shape/config.js into it by hand, or use a new board.`)
		process.exit(1)
	}
}

for (const file of ['config.js', 'mockShape.js']) copyFileSync(join(here, '../assets/shape', file), join(scriptDir, file))
writeFileSync(join(scriptDir, 'mockPoster.js'), `export default ${JSON.stringify(first)}\n`)
writeFileSync(join(scriptDir, 'mockPage.js'), `export const page = ${JSON.stringify({ html, js, width, height, title })}\n`)

let status
for (let i = 0; i < 40; i++) {
	await new Promise((r) => setTimeout(r, 500))
	status = await call('GET', `/api/doc/${doc.id}/script-status`)
	if (status.state !== 'pending') break
}
if (status.state !== 'applied') throw new Error(`Script ${status.state}: ${status.lastApplyError ?? `see ${status.errorLogPath}`}`)

// A new shape type registers a moment after the script applies, so retry.
const place = `
const { createShapeId } = await import('tldraw')
const id = createShapeId('ui-mock')
const shape = editor.getShape(id)
if (!shape) {
	const bounds = editor.getCurrentPageBounds()
	editor.createShape({ id, type: 'ui-mock', x: bounds ? bounds.maxX + 120 : 0, y: bounds ? bounds.minY : 0, props: { w: ${width}, h: ${height} } })
	editor.zoomToFit()
} else if (Math.abs(shape.props.w / shape.props.h - ${width / height}) > 0.001) {
	editor.updateShape({ id, type: 'ui-mock', props: { w: ${width}, h: ${height} } })
}
// Only a default name is replaced, so a page the user named keeps its name.
const home = editor.getPage(editor.getShape(id).parentId)
if (home && /^(Page \\d+|demo)$/.test(home.name) && !editor.getPages().some((p) => p.name === 'Demo')) editor.updatePage({ id: home.id, name: 'Demo' })
await helpers.saveDoc()
return shape ? 'updated' : 'created'`
let result
for (let i = 0; ; i++) {
	try {
		result = await exec(doc.id, place)
		break
	} catch (error) {
		if (i === 19) throw error
		await new Promise((r) => setTimeout(r, 500))
	}
}
console.log(`${result} clickable mock on "${board}", saved`)
if (shots.length) {
	const report = await upsertScreens(doc.id, shots, { width, height, pageId: 'page:screens', markRemoved: true })
	const stateReport = await upsertStates(doc.id, shots, { width, height })
	for (const [kind, result] of [['screen', report], ['state', stateReport]]) {
		if (!result) continue
		for (const { name, status } of result.images) console.log(`${kind} ${name}: ${status}`)
		for (const name of result.removed) console.log(`${kind} ${name}: no longer in mock, kept with its notes`)
		for (const { screen, note } of result.notes) console.log(`check note on ${screen}: ${note}`)
		for (const { screen, count } of result.comments ?? []) console.log(`check ${count} open comment(s) on ${screen}`)
		if (result.comments === null) console.log('warning: could not read comment threads, so check them by hand')
	}
	if (report.arrowsRemoved) console.log(`removed ${report.arrowsRemoved} old flow arrow(s)`)
}
for (const warning of warnings) console.log(`warning: ${warning}`)
console.log(`board file: ${doc.filePath}`)
