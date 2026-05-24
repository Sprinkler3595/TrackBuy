/**
 * Password strength validation for vault creation.
 *
 * Rules — all must pass:
 *   - length ≥ 12
 *   - at least one lowercase letter
 *   - at least one uppercase letter
 *   - at least one digit
 *   - at least one non-alphanumeric character
 *
 * Applies only to vault *creation*. Unlock does not re-evaluate (an existing
 * vault may legitimately have a weaker password from before the rule).
 */

export interface PasswordCheck {
  label: string
  ok: boolean
}

export interface PasswordEval {
  checks: PasswordCheck[]
  ok: boolean
  /** Rough 0–4 strength bucket for UI hints. */
  score: number
}

const MIN_LENGTH = 12

export function evaluatePassword(pwd: string): PasswordEval {
  const checks: PasswordCheck[] = [
    { label: `Au moins ${MIN_LENGTH} caractères`, ok: pwd.length >= MIN_LENGTH },
    { label: "Une lettre minuscule", ok: /[a-z]/.test(pwd) },
    { label: "Une lettre majuscule", ok: /[A-Z]/.test(pwd) },
    { label: "Un chiffre", ok: /\d/.test(pwd) },
    { label: "Un caractère spécial", ok: /[^A-Za-z0-9]/.test(pwd) },
  ]
  const ok = checks.every((c) => c.ok)

  // Crude strength signal independent of the rules above, useful for showing
  // a "still weak even though it passes" warning on very short alphabets.
  let score = 0
  if (pwd.length >= 8) score++
  if (pwd.length >= 12) score++
  if (pwd.length >= 16) score++
  if (/[^A-Za-z0-9]/.test(pwd) && /\d/.test(pwd) && /[A-Z]/.test(pwd)) score++

  return { checks, ok, score: Math.min(score, 4) }
}
