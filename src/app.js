import { createLoan, formatCordobas, getBalance, recordPayment, summarizeLoans, toCents } from "./domain/loans.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "control-prestamos-demo-v1";
const demoLoans = [
  { id: "demo-1", client: "María López", principalCents: 250000, interestCents: 75000, totalDueCents: 325000, months: 2, monthlyRate: 0.15, paidCents: 50000, note: "Pago quincenal", createdAt: "2026-10-21T12:00:00.000Z", payments: [{ id: "p-1", amountCents: 50000, note: "Primer abono", paidAt: "2026-10-25T12:00:00.000Z" }] },
  { id: "demo-2", client: "Carlos Ruiz", principalCents: 120000, interestCents: 18000, totalDueCents: 138000, months: 1, monthlyRate: 0.15, paidCents: 0, note: "", createdAt: "2026-10-23T12:00:00.000Z", payments: [] }
];
let loans = loadLoans();
let mode = "simple";
let entryType = "loan";
let selectedLoanId = null;

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
function formatDate(value) {
  if (!value) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-NI", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Managua" }).format(new Date(value));
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.hidden = false;
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3000);
}
function render() {
  const summary = summarizeLoans(loans);
  $("#outstanding-total").textContent = formatCordobas(summary.outstandingCents);
  $("#active-count").textContent = String(summary.activeCount);
  $("#lent-total").textContent = formatCordobas(summary.principalCents);
  $("#paid-total").textContent = formatCordobas(summary.paidCents);\n  $("#interest-collected").textContent = formatCordobas(summary.interestCollectedCents);\n  $("#interest-expected").textContent = formatCordobas(summary.interestExpectedCents);
  const query = $("#search").value.trim().toLocaleLowerCase("es");
  const filtered = loans.filter((loan) => loan.client.toLocaleLowerCase("es").includes(query));
  $("#empty-state").hidden = filtered.length > 0;
  $("#empty-state").textContent = query ? "No encontramos préstamos pendientes con ese nombre." : "No hay préstamos pendientes. Puedes registrar uno nuevo.";
  $("#record-list").innerHTML = filtered.map((loan) => `
    <article class="record-card">
      <div class="record-avatar" aria-hidden="true">${escapeHtml(loan.client.slice(0, 1).toUpperCase())}</div>
      <div class="record-main"><h3>${escapeHtml(loan.client)}</h3><p>Capital: ${formatCordobas(loan.principalCents)} · ${loan.months ?? 1} mes(es) al 15%</p><p>Total acordado: ${formatCordobas(loan.totalDueCents ?? loan.principalCents)}</p><small>Registrado: ${formatDate(loan.createdAt)}</small>${loan.note ? `<small>${escapeHtml(loan.note)}</small>` : ""}</div>
      <div class="record-balance"><span>Saldo pendiente</span><strong>${formatCordobas(getBalance(loan))}</strong><div class="record-actions"><button class="small-pay-button" data-pay="${escapeHtml(loan.id)}" type="button" ${getBalance(loan) <= 0 ? "disabled" : ""}>＋ Abono</button><button class="small-repeat-button" data-repeat="${escapeHtml(loan.id)}" type="button">↻ Prestar de nuevo</button></div></div>
    </article>`).join("");
  $("#history-list").innerHTML = loans.length ? loans.slice().reverse().map((loan) => `<div class="history-row"><strong>${escapeHtml(loan.client)}</strong><span>Préstamo ${formatCordobas(loan.principalCents)}</span><span>Abonado ${formatCordobas(loan.paidCents)}</span><span>Pendiente ${formatCordobas(getBalance(loan))}</span><span>Registrado ${formatDate(loan.createdAt)}</span></div>`).join("") : "<p>Sin movimientos registrados.</p>";
}
function openForm(type, client = "", loanId = null) {
  entryType = type;
  selectedLoanId = loanId;
  $("#entry-type").value = type;
  $("#entry-title").textContent = type === "loan" ? "Registrar préstamo" : type === "repeat" ? "Prestar de nuevo" : "Registrar abono";
  $("#client-name").value = client;
  $("#client-name").readOnly = Boolean(client);
  $("#months-field").hidden = type === "payment";
  $("#months").required = type !== "payment";
  $("#months").value = "1";
  $("#terms-preview").hidden = type === "payment";
  $("#amount").value = "";
  $("#entry-note").value = "";
  $("#form-error").hidden = true;
  updateTermsPreview();
  $("#entry-panel").hidden = false;
  $("#client-name").focus();
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
$("#show-payment-form").addEventListener("click", () => { const active = loans.filter((loan) => getBalance(loan) > 0); if (active.length === 1) openForm("payment", active[0].client, active[0].id); else showToast("Selecciona «＋ Abono» en la tarjeta del préstamo exacto."); });
$("#close-form").addEventListener("click", closeForm);
$("#cancel-form").addEventListener("click", closeForm);
$("#search").addEventListener("input", render);
$("#record-list").addEventListener("click", (event) => {
  const payButton = event.target.closest("[data-pay]");
  const repeatButton = event.target.closest("[data-repeat]");
  if (payButton) {
    const loan = loans.find((item) => item.id === payButton.dataset.pay);
    if (loan) openForm("payment", loan.client, loan.id);
    return;
  }
  if (repeatButton) {
    const loan = loans.find((item) => item.id === repeatButton.dataset.repeat);
    if (loan) openForm("repeat", loan.client);
  }
});
function updateTermsPreview() {
  const principal = Number($("#amount").value);
  const months = Number($("#months").value);
  if (!principal || principal <= 0 || !Number.isInteger(months) || months < 1 || months > 120) {
    $("#terms-preview").textContent = "Interés simple fijo: 15% por mes.";
    return;
  }
  const principalCents = Math.round(principal * 100);
  const interestCents = Math.round(principalCents * 0.15 * months);
  $("#terms-preview").textContent = `Interés: ${formatCordobas(interestCents)} · Total a devolver: ${formatCordobas(principalCents + interestCents)} (sin capitalizar intereses).`;
}
$("#amount").addEventListener("input", updateTermsPreview);
$("#months").addEventListener("input", updateTermsPreview);
$("#entry-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = $("#form-error");
  try {
    const client = $("#client-name").value.trim();
    const amountCents = toCents($("#amount").value);
    const months = Number($("#months").value);
    const note = $("#entry-note").value.trim();
    if (amountCents <= 0) throw new RangeError("Escribe un monto mayor que cero.");
    if (entryType === "loan" || entryType === "repeat") {
      loans.unshift(createLoan({ id: crypto.randomUUID(), client, principalCents: amountCents, months, note, createdAt: new Date().toISOString() }));
      showToast(entryType === "repeat" ? "Nuevo préstamo registrado; el historial anterior se conserva." : "Préstamo registrado correctamente.");
    } else {
      const loan = loans.find((item) => item.id === selectedLoanId);
      if (!loan) throw new Error("No se identificó el préstamo exacto al que se aplicará el abono. Vuelve a abrirlo desde su tarjeta.");
      const updated = recordPayment(loan, { amountCents, note, paidAt: new Date().toISOString() });
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
