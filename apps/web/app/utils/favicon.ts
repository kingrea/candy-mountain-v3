import type { Workspace } from '@crab-shack/platform-sdk'

export const DEFAULT_FAVICON = '/brand/favicon-64.png'

export function projectFaviconColor(slug: unknown, projects: Pick<Workspace, 'slug' | 'color'>[]): string | null {
  const color = projects.find(project => project.slug === slug)?.color
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null
}

/** Replace peppermint red with an accent, retaining white stripes and edge transparency. */
export function tintFaviconPixels(pixels: Uint8ClampedArray, color: string): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels)
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
  for (let i = 0; i < result.length; i += 4) {
    const white = Math.min(pixels[i + 1]!, pixels[i + 2]!) / Math.max(pixels[i]!, 1)
    for (let channel = 0; channel < 3; channel++) {
      result[i + channel] = 255 * white + rgb[channel]! * (1 - white)
    }
  }
  return result
}

let faviconImage: Promise<HTMLImageElement> | undefined

export async function coloredFavicon(color: string): Promise<string> {
  faviconImage ??= new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      faviconImage = undefined
      reject(new Error('Could not load favicon'))
    }
    image.src = DEFAULT_FAVICON
  })
  const image = await faviconImage
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return DEFAULT_FAVICON
  context.drawImage(image, 0, 0, 64, 64)
  const frame = context.getImageData(0, 0, 64, 64)
  frame.data.set(tintFaviconPixels(frame.data, color))
  context.putImageData(frame, 0, 0)
  return canvas.toDataURL('image/png')
}
