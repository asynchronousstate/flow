/** Keep the matching words in a short readable context instead of truncating them. */
export function searchExcerpt(text: string, query: string, maxLength = 170) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const match = normalized
    .toLocaleLowerCase()
    .indexOf(query.trim().toLocaleLowerCase())
  const start = match < 0 ? 0 : Math.max(0, match - Math.floor(maxLength / 3))
  const end = Math.min(normalized.length, start + maxLength)
  return `${start ? '…' : ''}${normalized.slice(start, end).trim()}${
    end < normalized.length ? '…' : ''
  }`
}
