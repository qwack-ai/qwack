import type { IRepository } from "../repo/types"

export const ADJECTIVES = [
  "SWIFT",
  "BOLD",
  "CALM",
  "KEEN",
  "WARM",
  "BRIGHT",
  "LUCKY",
  "NOBLE",
  "QUICK",
  "WITTY",
  "BRAVE",
  "LIVELY",
  "MERRY",
  "NIMBLE",
  "PLUCKY",
  "STEADY",
  "CLEVER",
  "DARING",
  "GENTLE",
  "JOLLY",
]

export const NOUNS = [
  "DUCK",
  "POND",
  "NEST",
  "FLOCK",
  "MARSH",
  "BROOK",
  "REEDS",
  "QUILL",
  "PLUME",
  "WADDLE",
  "HERON",
  "COVE",
  "CREEK",
  "GROVE",
  "SHORE",
  "DELTA",
  "FJORD",
  "INLET",
  "LEDGE",
  "RIDGE",
]

export const SHORT_CODE_NUM_RANGE = 100

export async function generateShortCode(repo: IRepository, maxRetries = 10): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    const num = Math.floor(Math.random() * SHORT_CODE_NUM_RANGE)
    const code = `${adj}-${noun}-${num}`
    const taken = await repo.isShortCodeTaken(code)
    if (!taken) return code
  }
  return `QWACK-${Date.now() % 100000}`
}
