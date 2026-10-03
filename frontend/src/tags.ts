// Tags are free-form labels for your own prioritising ("referral", "dream job"). They are normalised the same way
// the server does (backend/app/tags.py), so the box never shows something the server would then change: lower case,
// runs of whitespace collapsed. "Dream Job" and "dream  job" are one tag.
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 30

export const normalizeTag = (raw: string) => raw.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean).join(' ')

export interface AddResult {
  tags: string[] // the tags afterwards, sorted
  problem: string | null // why something was not added, in words for the person typing
}

// Adds what was typed or pasted ("a, b; c") to `current`. A comma or semicolon ends a tag. Repeats and blanks are
// ignored quietly; a tag that is too long, or one past the limit, is left out and explained.
export function addTags(current: string[], typed: string): AddResult {
  const tags = new Set(current)
  let problem: string | null = null
  for (const piece of typed.split(/[,;]/)) {
    const tag = normalizeTag(piece)
    if (!tag || tags.has(tag)) continue
    if (tag.length > MAX_TAG_LENGTH) {
      problem = `A tag can be at most ${MAX_TAG_LENGTH} characters.`
      continue
    }
    if (tags.size >= MAX_TAGS) {
      problem = `An application can have at most ${MAX_TAGS} tags.`
      break
    }
    tags.add(tag)
  }
  return { tags: [...tags].sort(), problem }
}
