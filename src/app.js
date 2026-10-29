import { createLoan, formatCordobas, getBalance, recordPayment, summarizeLoans, toCents } from "./domain/loans.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "control-prestamos-demo-v1";
const demoLoans = [
  { id: "demo-1", client: "María López", principalCents: 250000, paidCents: 50000, note: "Pago quincenal", createdAt: "2026-10-21T12:00:00.000Z", payments: [{ id: "p-1", amountCents: 50000, note: "Primer abono", paidAt: "2026-10-25T12:00:00.000Z" }] },
  { id: "demo-2", client: "Carlos Ruiz", principalCents: 120000, paidCents: 0, note: "", createdAt: "2026-10-23T12:00:00.000Z", payments: [] }
];
let loans = loadLoans();
let mode = "simple";
let entryType = "loan";\nlet selectedLoanId = null;

function loadLoans() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : demoLoans.map((loan) => ({ ...loan, payments: [...loan.payments] }));
  } catch {
    return demoLoans.map((loan) => ({ ...loan, payments: [...loan.payments] }));
  }
}
function saveLoans() { localStorage.setItem(STORAGE_KEY, JSON.stringify(loans)); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function formatDate(value) {\n  if (!value) return "Fecha no disponible";\n  return new Intl.DateTimeFormat("es-NI", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Managua" }).format(new Date(value));\n}\nfunction showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.hidden = false;
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3000);
}
function render() {
  const summary = summarizeLoans(loans);
  $("#outstanding-total").textContent = formatCordobas(summary.outstandingCents);
  $("#active-count").textContent = String(summary.activeCount);
  $("#lent-total").textContent = formatCordobas(summary.principalCents);
  $("#paid-total").textContent = formatCordobas(summary.paidCents);
  const query = $("#search").value.trim().toLocaleLowerCase("es");
  const filtered = loans.filter((loan) => loan.client.toLocaleLowerCase("es").includes(query) && getBalance(loan) > 0);
  $("#empty-state").hidden = filtered.length > 0;
  $("#empty-state").textContent = query ? "No encontramos préstamos pendientes con ese nombre." : "No hay préstamos pendientes. Puedes registrar uno nuevo.";
  $("#record-list").innerHTML = filtered.map((loan) => `
    <article class="record-card">
      <div class="record-avatar" aria-hidden="true">${escapeHtml(loan.client.slice(0, 1).toUpperCase())}</div>
      <div class="record-main"><h3>${escapeHtml(loan.client)}</h3><p>Préstamo: ${formatCordobas(loan.principalCents)}</p>${loan.note ? `<small>${escapeHtml(loan.note)}</small>` : ""}</div>
      <div class="record-balance"><span>Debe</span><strong>${formatCordobas(getBalance(loan))}</strong><button class="small-pay-button" data-pay="${escapeHtml(loan.id)}" type="button">＋ Abono</button></div>
    </article>`).join("");
  $("#history-list").innerHTML = loans.length ? loans.slice().reverse().map((loan) => `<div class="history-row"><strong>${escapeHtml(loan.client)}</strong><span>Préstamo ${formatCordobas(loan.principalCents)}</span><span>Abonado ${formatCordobas(loan.paidCents)}</span><span>Pendiente ${formatCordobas(getBalance(loan))}</span></div>`).join("") : "<p>Sin movimientos registrados.</p>";
}
function openForm(type, client = "") {
  entryType = type; $("#entry-type").value = type;
  $("#entry-title").textContent = type === "loan" ? "Registrar préstamo" : "Registrar abono";
  $("#client-name").value = client;
  $("#client-name").readOnly = Boolean(client);
  $("#amount").value = ""; $("#entry-note").value = ""; $("#form-error").hidden = true;
  $("#entry-panel").hidden = false; $("#client-name").focus();
  $("#entry-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function closeForm() { $("#entry-panel").hidden = true; $("#client-name").readOnly = false; selectedLoanId = null; }
$("#simple-mode").addEventListener("click", () => setMode("simple"));
$("#owner-mode").addEventListener("click", () => setMode("owner"));
function setMode(nextMode) {
  mode = nextMode;
  $("#simple-mode").classList.toggle("is-active", mode === "simple");
  $("#owner-mode").classList.toggle("is-active", mode === "owner");
  $("#simple-mode").setAttribute("aria-pressed", String(mode === "simple"));
  $("#owner-mode").setAttribute("aria-pressed", String(mode === "owner"));
  document.body.classList.toggle("owner-mode", mode === "owner");
  document.querySelectorAll(".owner-only").forEach((node) => { node.hidden = mode !== "owner"; });
  $("#page-title").textContent = mode === "simple" ? "¿Qué vamos a hacer hoy?" : "Resumen de tu dinero";
  $("#page-description").textContent = mode === "simple" ? "Registra un préstamo o un abono en pocos pasos." : "Consulta los saldos y movimientos registrados.";
  $("#records-title").textContent = mode === "simple" ? "Préstamos pendientes" : "Cartera de préstamos";
}
$("#show-loan-form").addEventListener("click", () => openForm("loan"));
$("#show-payment-form").addEventListener("click", () => openForm("payment"));
$("#close-form").addEventListener("click", closeForm);
$("#cancel-form").addEventListener("click", closeForm);
$("#search").addEventListener("input", render);\nfunction updateTermsPreview() { const principal = Number($("#amount").value); const months = Number($("#months").value); const preview = $("#terms-preview"); if (!principal || principal <= 0 || !Number.isInteger(months) || months < 1) { preview.textContent = "Interés simple: 15% por mes."; return; } const interest = Math.round(principal * 100 * 0.15 * months); const total = Math.round(principal * 100) + interest; preview.textContent = `Interés: ${formatCordobas(interest)} · Total a devolver: ${formatCordobas(total)} (sin capitalizar intereses).`; }\n$("#amount").addEventListener("input", updateTermsPreview); $("#months").addEventListener("input", updateTermsPreview);
$("#record-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay]");
  if (!button) return;
  const loan = loans.find((item) => item.id === button.dataset.pay);
  if (loan) openForm("payment", loan.client);
});
$("#entry-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = $("#form-error");
  try {
    const client = $("#client-name").value.trim();
    const amountCents = toCents($("#amount").value);
    const note = $("#entry-note").value.trim();
    if (amountCents <= 0) throw new RangeError("Escribe un monto mayor que cero.");
    if (entryType === "loan") {
      loans.unshift(createLoan({ id: crypto.randomUUID(), client, principalCents: amountCents, note }));
      showToast("Préstamo registrado correctamente.");
    } else {
      const loan = loans.find((item) => item.client.toLocaleLowerCase("es") === client.toLocaleLowerCase("es") && getBalance(item) > 0);
      if (!loan) throw new Error("No encontramos un préstamo pendiente de este cliente.");
      const updated = recordPayment(loan, { amountCents, note });
      loans = loans.map((item) => item.id === loan.id ? updated : item);
      showToast("Abono registrado correctamente.");
    }
    saveLoans(); render(); closeForm();
  } catch (exception) {
    error.textContent = exception.message || "No se pudo guardar el registro.";
    error.hidden = false;
  }
});
render();
