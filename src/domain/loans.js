export function toCents(value) {
  const amount = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("El importe debe ser un número no negativo.");
  return Math.round((amount + Number.EPSILON) * 100);
}

export function formatCordobas(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("El saldo debe expresarse en centavos enteros no negativos.");
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(cents / 100);
}

export function createLoan({ id, client, principalCents, note = "", createdAt = new Date().toISOString() }) {
  const normalizedClient = String(client ?? "").trim();
  if (!normalizedClient) throw new Error("El nombre del cliente es obligatorio.");
  if (!Number.isSafeInteger(principalCents) || principalCents <= 0) throw new RangeError("El préstamo debe ser mayor que cero.");
  return { id, client: normalizedClient, principalCents, paidCents: 0, note: String(note).trim(), createdAt, payments: [] };
}

export function recordPayment(loan, { amountCents, note = "", paidAt = new Date().toISOString() }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new RangeError("El abono debe ser mayor que cero.");
  const balanceCents = getBalance(loan);
  if (amountCents > balanceCents) throw new RangeError("El abono no puede superar el saldo pendiente.");
  const payment = { id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), amountCents, note: String(note).trim(), paidAt };
  const payments = [...loan.payments, payment];
  return { ...loan, paidCents: loan.paidCents + amountCents, payments };
}

export function getBalance(loan) {
  return Math.max(0, loan.principalCents - loan.paidCents);
}

export function summarizeLoans(loans) {
  return loans.reduce((summary, loan) => {
    summary.principalCents += loan.principalCents;
    summary.paidCents += loan.paidCents;
    summary.outstandingCents += getBalance(loan);
    if (getBalance(loan) > 0) summary.activeCount += 1;
    return summary;
  }, { principalCents: 0, paidCents: 0, outstandingCents: 0, activeCount: 0 });
}
