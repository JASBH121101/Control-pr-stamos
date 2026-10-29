import test from "node:test";
import assert from "node:assert/strict";
import { calculateLoanTerms, createLoan, formatCordobas, getBalance, recordPayment, summarizeLoans, toCents } from "../../src/domain/loans.js";

const sample = () => createLoan({ id: "loan-1", client: " Ana Pérez ", principalCents: 500000, months: 3, createdAt: "2026-01-01T00:00:00.000Z" });

test("converts decimal currency into integer cents", () => {
  assert.equal(toCents("12.50"), 1250);
  assert.equal(toCents(0.1 + 0.2), 30);
});
test("rejects invalid or negative money", () => {
  assert.throws(() => toCents(-1), /no negativo/);
  assert.throws(() => toCents("no es dinero"), /no negativo/);
});
test("simple interest is fixed at 15 percent monthly without compounding", () => {
  assert.deepEqual(calculateLoanTerms(500000, 3), { interestCents: 225000, totalDueCents: 725000, months: 3, monthlyRate: 0.15 });
  assert.throws(() => calculateLoanTerms(500000, 3, 0.1), /fijada en 15%/);
});
test("creates a normalized loan with interest, total and timestamp", () => {
  const loan = sample();
  assert.equal(loan.client, "Ana Pérez");
  assert.equal(loan.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(loan.interestCents, 225000);
  assert.equal(getBalance(loan), 725000);
});
test("requires a client name and positive principal", () => {
  assert.throws(() => createLoan({ id: "x", client: " ", principalCents: 100 }), /nombre/);
  assert.throws(() => createLoan({ id: "x", client: "Ana", principalCents: 0 }), /mayor que cero/);
  assert.throws(() => createLoan({ id: "x", client: "Ana", principalCents: 100, months: 0 }), /plazo/);
});
test("records payments against the specific loan and preserves exact timestamp", () => {
  const paid = recordPayment(sample(), { amountCents: 255000, note: "Primera cuota", paidAt: "2026-01-02T13:45:12.000Z" });
  assert.equal(paid.paidCents, 255000);
  assert.equal(getBalance(paid), 470000);
  assert.equal(paid.payments[0].paidAt, "2026-01-02T13:45:12.000Z");
});
test("rejects zero, negative, and over-balance payments", () => {
  const loan = sample();
  assert.throws(() => recordPayment(loan, { amountCents: 0 }), /mayor que cero/);
  assert.throws(() => recordPayment(loan, { amountCents: -1 }), /mayor que cero/);
  assert.throws(() => recordPayment(loan, { amountCents: 725001 }), /superar/);
});
test("keeps multiple loans for the same customer separate", () => {
  const first = sample();
  const second = createLoan({ id: "loan-2", client: "Ana Pérez", principalCents: 100000, months: 1 });
  const paidFirst = recordPayment(first, { amountCents: 100000 });
  assert.equal(paidFirst.id, first.id);
  assert.equal(paidFirst.paidCents, 100000);
  assert.equal(second.paidCents, 0);
  assert.equal(getBalance(second), 115000);
});
test("summarizes principal, payments, balance, expected and collected interest", () => {
  const a = recordPayment(sample(), { amountCents: 600000 });
  const b = createLoan({ id: "loan-2", client: "Luis", principalCents: 20000, months: 1 });
  const summary = summarizeLoans([a, b]);
  assert.equal(summary.principalCents, 520000);
  assert.equal(summary.paidCents, 600000);
  assert.equal(summary.outstandingCents, 140000);
  assert.equal(summary.interestExpectedCents, 228000);
  assert.equal(summary.interestCollectedCents, 100000);
  assert.equal(summary.activeCount, 2);
});
test("formats Nicaraguan cordobas", () => {
  assert.match(formatCordobas(12345), /123/);
});
