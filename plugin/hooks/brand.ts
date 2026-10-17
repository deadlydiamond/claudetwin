// OBS brand (Omer Bin Saleem): ground and ink carry the layout, the teal, cyan, violet
// gradient is for the one line that matters, and lime is only the spark.
export const BRAND = {
  teal: '#0B8F8C',
  cyan: '#00A7C4',
  violet: '#6A4CF0',
  lime: '#C8F560',
  ink: '#191B1E',
  night: '#0A0B0E',
  author: 'Omer Bin Saleem',
  tagline: 'Build with AI',
} as const

const FONT = `-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif`

const gradient = (id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${BRAND.teal}"/><stop offset=".45" stop-color="${BRAND.cyan}"/><stop offset="1" stop-color="${BRAND.violet}"/>` +
  `</linearGradient>`

// The ClaudeTwin mark: two linked rings (the two accounts) on the OBS tile, spark bottom right.
// `id` keeps gradient ids unique when the mark sits inside another drawing.
function markBody(id: string): string {
  return (
    `<defs>${gradient(`${id}g`)}<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="512" height="512" rx="116" fill="url(#${id}g)"/><rect width="512" height="512" rx="116" fill="url(#${id}s)"/>` +
    `<circle cx="206" cy="246" r="96" fill="none" stroke="#fff" stroke-width="44"/>` +
    `<circle cx="306" cy="246" r="96" fill="none" stroke="#fff" stroke-opacity=".78" stroke-width="44"/>` +
    `<circle cx="404" cy="400" r="20" fill="${BRAND.lime}"/>`
  )
}

export function markSvg(size = 40): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${markBody('m')}</svg>`
}

// Header lockup for the desktop panel: mark, name, and the byline.
export function headerSvg(status: { label: string; tone: 'ok' | 'busy' | 'off' }): string {
  const dot = status.tone === 'ok' ? '#2FBF71' : status.tone === 'busy' ? BRAND.cyan : '#E0A030'
  const pillW = 22 + status.label.length * 7.2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="56" viewBox="0 0 360 56">` +
    `<defs>${gradient('t')}</defs>` +
    `<g transform="translate(0 4) scale(0.09375)">${markBody('h')}</g>` +
    `<text x="62" y="27" font-family="${FONT}" font-weight="800" font-size="21" letter-spacing="-0.6" fill="url(#t)">ClaudeTwin</text>` +
    `<text x="62" y="46" font-family="${FONT}" font-size="12" fill="#8A8F98">by ${BRAND.author} · ${BRAND.tagline}</text>` +
    `<rect x="${360 - pillW}" y="10" width="${pillW}" height="22" rx="11" fill="${dot}" fill-opacity=".14"/>` +
    `<circle cx="${360 - pillW + 11}" cy="21" r="3.5" fill="${dot}"/>` +
    `<text x="${360 - pillW + 19}" y="25" font-family="${FONT}" font-weight="600" font-size="11.5" fill="${dot}">${status.label}</text>` +
    `</svg>`
  )
}

// A rounded progress bar in the brand gradient.
export function progressSvg(fraction: number, width = 360): string {
  const f = Math.max(0, Math.min(1, fraction))
  const w = Math.max(f > 0 ? 8 : 0, Math.round(f * width))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BRAND.teal}"/><stop offset=".5" stop-color="${BRAND.cyan}"/><stop offset="1" stop-color="${BRAND.violet}"/></linearGradient></defs>` +
    `<rect width="${width}" height="8" rx="4" fill="#8A8F98" fill-opacity=".18"/>` +
    (w ? `<rect width="${w}" height="8" rx="4" fill="url(#p)"/>` : '') +
    `</svg>`
  )
}

// The same bar in text cells, for the terminal.
export function progressText(fraction: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return '━'.repeat(filled) + '╌'.repeat(width - filled)
}
