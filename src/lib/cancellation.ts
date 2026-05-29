import { daysUntil, formatDate } from "@/lib/utils"
import type { Engagement, Creditor } from "@/lib/tauri"

/// "Cancel at the right time" helpers.
///
/// In Switzerland the n°1 contract headache is missing the *notice deadline*
/// (préavis): LAMal before end of November, insurances and tacitly-renewed
/// subscriptions weeks before their term. The data is already on every
/// engagement (`contract_end_date` + `notice_period_days`) — these helpers
/// turn it into an actionable deadline and a ready-to-send cancellation
/// letter.

/// How far ahead we surface a deadline, and how long after a missed one we
/// keep warning about it.
export const CANCELLATION_LOOKAHEAD_DAYS = 90
const MISSED_GRACE_DAYS = 14

export type CancellationSeverity = "missed" | "urgent" | "upcoming"

export interface CancellationInfo {
  /// Last day to send the cancellation (contract end − notice period), ISO.
  deadlineISO: string
  /// Whole days from today to that deadline (negative = already passed).
  daysUntilDeadline: number
  contractEndISO: string
  noticeDays: number
  severity: CancellationSeverity
}

/// Subtract `days` from an ISO date, returning a new YYYY-MM-DD string. Uses
/// local calendar arithmetic to stay consistent with `daysUntil`.
function subtractDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const dd = String(dt.getDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

/// Compute the cancellation deadline for an engagement, or null when it's not
/// applicable (not active, or missing the contract end / notice period).
export function getCancellationInfo(e: Engagement): CancellationInfo | null {
  if (e.status !== "active") return null
  if (!e.contract_end_date || e.notice_period_days == null) return null

  const deadlineISO = subtractDays(e.contract_end_date, e.notice_period_days)
  const daysUntilDeadline = daysUntil(deadlineISO)

  const severity: CancellationSeverity =
    daysUntilDeadline < 0 ? "missed" : daysUntilDeadline <= 30 ? "urgent" : "upcoming"

  return {
    deadlineISO,
    daysUntilDeadline,
    contractEndISO: e.contract_end_date,
    noticeDays: e.notice_period_days,
    severity,
  }
}

/// Should this engagement appear in the "deadlines to anticipate" list? True
/// for deadlines within the lookahead window, plus a short grace period after
/// a missed one so the user still notices it.
export function isCancellationRelevant(info: CancellationInfo): boolean {
  return (
    info.daysUntilDeadline >= -MISSED_GRACE_DAYS &&
    info.daysUntilDeadline <= CANCELLATION_LOOKAHEAD_DAYS
  )
}

/// Engagements with a relevant upcoming (or just-missed) cancellation deadline,
/// soonest first.
export function upcomingCancellations(
  engagements: Engagement[],
): Array<{ engagement: Engagement; info: CancellationInfo }> {
  return engagements
    .map((engagement) => {
      const info = getCancellationInfo(engagement)
      return info ? { engagement, info } : null
    })
    .filter((x): x is { engagement: Engagement; info: CancellationInfo } =>
      x != null && isCancellationRelevant(x.info),
    )
    .sort((a, b) => a.info.daysUntilDeadline - b.info.daysUntilDeadline)
}

/// Build a pre-filled French cancellation letter (registered-mail style).
/// Sender details aren't stored by the app, so they stay as bracketed
/// placeholders the user fills in (the letter is editable in the modal).
export function buildCancellationLetter(
  e: Engagement,
  creditor: Creditor | null,
): string {
  const recipient = creditor
    ? [creditor.name, creditor.address].filter(Boolean).join("\n")
    : e.creditor_name || "[Destinataire]"

  const reference = e.contract_reference
    ? ` (réf. contrat : ${e.contract_reference})`
    : ""
  const endDateLabel = formatDate(e.contract_end_date as string)

  return `[Votre prénom et nom]
[Votre adresse]
[NPA et localité]


${recipient}


[Lieu], le ${formatDate(new Date().toISOString())}

Lettre recommandée

Objet : Résiliation du contrat « ${e.name} »${reference}

Madame, Monsieur,

Par la présente, je vous informe de ma décision de résilier le contrat
mentionné en objet pour sa prochaine échéance, soit le ${endDateLabel}, dans
le respect du délai de préavis contractuel.

Je vous saurais gré de bien vouloir me confirmer par écrit la bonne réception
de cette résiliation ainsi que la date effective de fin du contrat.

Dans l'attente de votre confirmation, je vous prie d'agréer, Madame,
Monsieur, mes salutations distinguées.



[Votre signature]

[Votre prénom et nom]`
}
