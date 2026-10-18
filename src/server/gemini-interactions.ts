export const GEMINI_INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
export const GEMINI_MODEL_NAME = 'gemini-3.8-flash'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function outputTextFromInteraction(interaction: Record<string, unknown>): string {
  if (typeof interaction.output_text === 'string') return interaction.output_text
  if (!Array.isArray(interaction.steps)) return ''

  const textParts: string[] = []
  let collecting = false
  for (let i = interaction.steps.length - 1; i >= 0; i -= 1) {
    const step = interaction.steps[i]
    if (!isRecord(step)) continue
    if (step.type === 'user_input') break
    if (step.type === 'thought') continue
    if (step.type !== 'model_output') {
      if (collecting) break
      continue
    }
    if (!Array.isArray(step.content)) continue
    for (let j = step.content.length - 1; j >= 0; j -= 1) {
      const content = step.content[j]
      if (!isRecord(content)) continue
      if (content.type === 'text') {
        collecting = true
        textParts.push(typeof content.text === 'string' ? content.text : '')
      } else if (collecting) {
        return textParts.reverse().join('')
      }
    }
  }
  return textParts.reverse().join('')
}
