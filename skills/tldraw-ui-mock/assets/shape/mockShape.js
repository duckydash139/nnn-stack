import { ShapeUtil, Rectangle2d, HTMLContainer, T, resizeBox, stopEventPropagation, useIsEditing } from 'tldraw'
import { createElement, useEffect, useRef, useState } from 'react'
import { page } from './mockPage.js'
import poster from './mockPoster.js'

const pill = {
	padding: '5px 9px',
	borderRadius: 6,
	color: '#fff',
	font: '600 11px/14px -apple-system, system-ui, sans-serif',
	whiteSpace: 'nowrap',
}

// An iframe keeps the page's layout and CSS apart from tldraw's at any zoom. It
// takes pointer input only while editing, so at rest the shape moves, selects
// and sits under annotations like any other.
function MockFrame({ shape, editor }) {
	const editing = useIsEditing(shape.id)
	const frame = useRef(null)
	const [run, setRun] = useState(0)
	const scale = shape.props.w / page.width

	useEffect(() => {
		if (editing) frame.current?.contentWindow?.focus()
	}, [editing])

	return createElement(
		HTMLContainer,
		{ style: { overflow: 'hidden', pointerEvents: 'all' } },
		createElement('iframe', {
			// A new key remounts the iframe, which is what Reset does
			key: run,
			ref: frame,
			title: page.title,
			srcDoc: page.html,
			// The app's security policy blocks inline scripts but allows eval
			onLoad: (e) => {
				const win = e.currentTarget.contentWindow
				win.eval(page.js)
				// Keys go to the frame while it has focus, so Esc is caught here
				win.addEventListener('keydown', (key) => {
					if (key.key === 'Escape') editor.cancel()
				})
				if (editor.getEditingShapeId() === shape.id) win.focus()
			},
			style: {
				width: page.width,
				height: page.height,
				border: 0,
				display: 'block',
				pointerEvents: editing ? 'auto' : 'none',
				transformOrigin: 'top left',
				transform: `scale(${scale})`,
			},
		}),
		createElement(
			'div',
			{ style: { position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, pointerEvents: 'none' } },
			createElement(
				'button',
				{
					title: 'Return the mock to its first screen',
					onPointerDown: stopEventPropagation,
					onPointerUp: stopEventPropagation,
					onDoubleClick: stopEventPropagation,
					onClick: (e) => {
						stopEventPropagation(e)
						setRun((n) => n + 1)
					},
					style: { ...pill, border: 0, cursor: 'pointer', background: 'rgba(15, 40, 80, 0.72)', pointerEvents: 'all' },
				},
				'Reset'
			),
			createElement(
				'div',
				{ style: { ...pill, background: editing ? '#0f62d6' : 'rgba(15, 40, 80, 0.72)' } },
				editing ? 'Esc to exit' : 'Double-click to use'
			)
		)
	)
}

export class MockShapeUtil extends ShapeUtil {
	static type = 'ui-mock'
	static props = { w: T.number, h: T.number }

	getDefaultProps() {
		return { w: page.width, h: page.height }
	}

	canEdit() {
		return true
	}

	isAspectRatioLocked() {
		return true
	}

	getGeometry(shape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	component(shape) {
		return createElement(MockFrame, { shape, editor: this.editor })
	}

	// An iframe cannot be drawn into an export, so exports show the first screen
	toSvg(shape) {
		return createElement('image', { href: poster, width: shape.props.w, height: shape.props.h })
	}

	getIndicatorPath(shape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	onResize(shape, info) {
		return resizeBox(shape, info)
	}
}
