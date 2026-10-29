export const MONTHLY_INTEREST_RATE = 0.15;

export function toCents(value) {
  const amount = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("El importe debe ser un número no negativo.");
  return Math.round((amount + Number.EPSILON) * 100);
}

export function formatCordobas(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("El saldo debe expresarse en centavos enteros no negativos.");
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(cents / 100);
}

export function calculateLoanTerms(principalCents, months, monthlyRate = MONTHLY_INTEREST_RATE) {
  if (!Number.isSafeInteger(principalCents) || principalCents <= 0) throw new RangeError("El préstamo debe ser mayor que cero.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError("El plazo debe estar entre 1 y 120 meses.");
  if (monthlyRate !== MONTHLY_INTEREST_RATE) throw new RangeError("La tasa mensual está fijada en 15%.");
  const interestCents = Math.round(principalCents * monthlyRate * months);
  return { interestCents, totalDueCents: principalCents + interestCents, months, monthlyRate };
}

export function calculateMonthlyReferenceCents(totalDueCents, months) {
  if (!Number.isSafeInteger(totalDueCents) || totalDueCents <= 0) throw new RangeError("El total a devolver debe ser mayor que cero.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError("El plazo debe estar entre 1 y 120 meses.");
  return Math.round(totalDueCents / months);
}

export function createLoan({ id, client, principalCents, months = 1, note = "", createdAt = new Date().toISOString() }) {
  const normalizedClient = String(client ?? "").trim();
  if (!normalizedClient) throw new Error("El nombre del cliente es obligatorio.");
  const terms = calculateLoanTerms(principalCents, months);
  return { id, client: normalizedClient, principalCents, ...terms, paidCents: 0, note: String(note).trim(), createdAt, payments: [] };
}

export function recordPayment(loan, { amountCents, note = "", paidAt = new Date().toISOString() }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new RangeError("El abono debe ser mayor que cero.");
  const balanceCents = getBalance(loan);
  if (amountCents > balanceCents) throw new RangeError("El abono no puede superar el saldo pendiente.");
  const payment = { id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), amountCents, note: String(note).trim(), paidAt };
  return { ...loan, paidCents: loan.paidCents + amountCents, payments: [...loan.payments, payment] };
}

export function getBalance(loan) {
  return Math.max(0, (loan.totalDueCents ?? loan.principalCents) - loan.paidCents);
}

export function summarizeLoans(loans) {
  return loans.reduce((summary, loan) => {
    summary.principalCents += loan.principalCents;
    summary.paidCents += loan.paidCents;
    summary.outstandingCents += getBalance(loan);
    summary.interestExpectedCents += loan.interestCents ?? 0;
    summary.interestCollectedCents += Math.max(0, Math.min(loan.interestCents ?? 0, loan.paidCents - loan.principalCents));
    if (getBalance(loan) > 0) summary.activeCount += 1;
    return summary;
  }, { principalCents: 0, paidCents: 0, outstandingCents: 0, interestExpectedCents: 0, interestCollectedCents: 0, activeCount: 0 });
}
