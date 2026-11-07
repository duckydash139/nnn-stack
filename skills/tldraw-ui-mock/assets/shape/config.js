// tldraw-ui-mock
import { MockShapeUtil } from './mockShape.js'

export default function ({ config }) {
	config.shapeUtils.push(MockShapeUtil)
	return config
}
