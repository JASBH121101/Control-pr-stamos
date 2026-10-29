import test from "node:test";
import assert from "node:assert/strict";
import { createLoan, formatCordobas, getBalance, recordPayment, summarizeLoans, toCents } from "../../src/domain/loans.js";

const sample = () => createLoan({ id: "loan-1", client: " Ana Pérez ", principalCents: 12550, createdAt: "2026-01-01T00:00:00.000Z" });

test("converts decimal currency into integer cents", () => {
  assert.equal(toCents("12.50"), 1250);
  assert.equal(toCents(0.1 + 0.2), 30);
});
test("rejects invalid or negative money", () => {
  assert.throws(() => toCents(-1), /no negativo/);
  assert.throws(() => toCents("no es dinero"), /no negativo/);
});
test("creates a normalized loan with full balance", () => {
  const loan = sample();
  assert.equal(loan.client, "Ana Pérez");
  assert.equal(getBalance(loan), 12550);
});
test("requires a client name and positive principal", () => {
  assert.throws(() => createLoan({ id: "x", client: " ", principalCents: 100 }), /nombre/);
  assert.throws(() => createLoan({ id: "x", client: "Ana", principalCents: 0 }), /mayor que cero/);
});
test("records a partial payment and calculates remaining balance", () => {
  const paid = recordPayment(sample(), { amountCents: 2550, note: "Primera cuota", paidAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(paid.paidCents, 2550);
  assert.equal(getBalance(paid), 10000);
  assert.equal(paid.payments.length, 1);
});
test("rejects zero, negative, and over-balance payments", () => {
  const loan = sample();
  assert.throws(() => recordPayment(loan, { amountCents: 0 }), /mayor que cero/);
  assert.throws(() => recordPayment(loan, { amountCents: -1 }), /mayor que cero/);
  assert.throws(() => recordPayment(loan, { amountCents: 12551 }), /superar/);
});
test("summarizes total principal, payments, balance, and active loans", () => {
  const a = recordPayment(sample(), { amountCents: 12550 });
  const b = createLoan({ id: "loan-2", client: "Luis", principalCents: 20000 });
  assert.deepEqual(summarizeLoans([a, b]), { principalCents: 32550, paidCents: 12550, outstandingCents: 20000, activeCount: 1 });
});
test("formats Nicaraguan cordobas", () => {
  assert.match(formatCordobas(12345), /123/);
});
