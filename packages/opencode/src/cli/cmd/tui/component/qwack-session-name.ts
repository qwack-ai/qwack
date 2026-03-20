const ADJECTIVES = [
  "Swift", "Bold", "Calm", "Keen", "Warm",
  "Bright", "Lucky", "Noble", "Quick", "Witty",
  "Brave", "Lively", "Merry", "Nimble", "Plucky",
  "Steady", "Clever", "Daring", "Gentle", "Jolly",
]
const NOUNS = [
  "Duck", "Pond", "Nest", "Flock", "Marsh",
  "Brook", "Reeds", "Quill", "Plume", "Waddle",
  "Heron", "Cove", "Creek", "Grove", "Shore",
  "Delta", "Fjord", "Inlet", "Ledge", "Ridge",
]

export function qwackSessionName(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const a = Math.abs(hash) % ADJECTIVES.length
  const n = Math.abs(hash >> 8) % NOUNS.length
  return `${ADJECTIVES[a]} ${NOUNS[n]}`
}
