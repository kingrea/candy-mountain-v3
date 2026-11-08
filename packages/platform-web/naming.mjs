import { basename, dirname, extname, relative } from 'node:path'

// Naming follows scule and Nuxt 4.6's component naming so names match what Nuxt registers.

function isUppercase(char = '') {
  if (/\d/.test(char)) return undefined
  return char !== char.toLowerCase()
}

/** @param {string} str */
export function splitByCase(str) {
  const parts = []
  if (!str) return parts
  let buff = ''
  let previousUpper
  let previousSplitter
  for (const char of str) {
    const isSplitter = ['-', '_', '/', '.'].includes(char)
    if (isSplitter) {
      parts.push(buff)
      buff = ''
      previousUpper = undefined
      continue
    }
    const isUpper = isUppercase(char)
    if (previousSplitter === false) {
      if (previousUpper === false && isUpper === true) {
        parts.push(buff)
        buff = char
        previousUpper = isUpper
        continue
      }
      if (previousUpper === true && isUpper === false && buff.length > 1) {
        const lastChar = buff.at(-1)
        parts.push(buff.slice(0, -1))
        buff = lastChar + char
        previousUpper = isUpper
        continue
      }
    }
    buff += char
    previousUpper = isUpper
    previousSplitter = isSplitter
  }
  parts.push(buff)
  return parts
}

/** @param {string} str */
export const upperFirst = str => (str ? str[0].toUpperCase() + str.slice(1) : '')

/** @param {string[]} parts */
export const pascalCase = parts => parts.map(upperFirst).join('')

/** @param {string} str */
export function camelCase(str) {
  const pascal = pascalCase(splitByCase(str))
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : ''
}

/** The components prefix of a layer id: `issues` -> `Issues`, `agent-hub` -> `AgentHub`. @param {string} layer */
export function layerPrefix(layer) {
  return pascalCase(splitByCase(layer))
}

const isGroupingFolder = segment => /^\(.*\)$/.test(segment.trim())

function resolveComponentNameSegments(fileName, prefixParts) {
  const fileNameParts = splitByCase(fileName)
  const fileNamePartsContent = fileNameParts.join('/').toLowerCase()
  const componentPrefixParts = prefixParts.filter(part => !isGroupingFolder(part))
  const componentNameParts = componentPrefixParts.flatMap(p => splitByCase(p))
  let index = componentPrefixParts.length - 1
  const matchedSuffix = []
  while (index >= 0) {
    const prefixPart = componentPrefixParts[index]
    matchedSuffix.unshift(...splitByCase(prefixPart).map(p => p.toLowerCase()))
    const matchedSuffixContent = matchedSuffix.join('/')
    if (
      fileNamePartsContent === matchedSuffixContent
      || fileNamePartsContent.startsWith(matchedSuffixContent + '/')
      || (prefixPart.toLowerCase() === fileNamePartsContent && componentPrefixParts[index + 1] === prefixPart)
    ) {
      componentNameParts.length = index
    }
    index--
  }
  return [...componentNameParts, ...fileNameParts]
}

/**
 * The name Nuxt registers for a component file under a layer's components directory with that layer's prefix.
 * @param {string} componentsDir
 * @param {string} file
 * @param {string} prefix
 */
export function componentName(componentsDir, file, prefix) {
  const prefixParts = [...splitByCase(prefix), ...splitByCase(relative(componentsDir, dirname(file)))]
  let fileName = basename(file, extname(file)).replace(/(?:\.(?:client|server))?(?:\.global|\.island)*$/, '')
  if (fileName.toLowerCase() === 'index') fileName = ''
  return pascalCase(resolveComponentNameSegments(fileName.replace(/["']/g, ''), prefixParts).filter(Boolean))
}

export const COMPONENT_FILE = /\.(?:vue|[jt]sx?)$/
export const NOT_A_COMPONENT = /(?:[-.]?[Mm]ixin\.[jt]sx?|\.d\.[cm]?ts|\.(?:spec|stories|test)\.[jt]sx?)$/
