import { calculateLoanTerms, calculateMonthlyReferenceCents, formatCordobas, toCents } from "./domain/loans.js";
import { hasVault, createVault, unlockVault, saveVault, getVault, lockVault, getBiometricInfo, enableBiometricUnlock, unlockVaultWithBiometric, disableBiometricUnlock } from "./offline-store.js";
const SUPABASE_URL = "https://ctdcqwffzhpzgevqahob.supabase.co";
const SUPABASE_KEY = "sb_publishable_OV4MxEx5M-nRNQWnaOVXcA_B7YW8z73";
let supabase = null;
async function getSupabase() {
  if (!navigator.onLine) throw new TypeError("Sin conexión a Internet.");
  if (!supabase) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.0");
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}
function isNetworkError(error) {
  return !navigator.onLine || /failed to fetch|fetch failed|network|load failed|sin conexión|connection/i.test(String(error?.message || ""));
}

const BIOMETRIC_ENDPOINT = SUPABASE_URL + "/functions/v1/operator-biometric";
function base64urlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function bufferToBase64url(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function extensionBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}
function getPrfOutput(credential) {
  const output = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  const bytes = extensionBytes(output);
  if (!bytes || bytes.length < 32) throw new Error("Este celular o navegador no ofrece la extensión biométrica segura necesaria. Puedes seguir usando el PIN.");
  return bytes;
}
async function biometricApi(action, extra = {}) {
  if (!navigator.onLine) throw new Error("Conéctate a Internet para verificar la huella con el servidor.");
  const sb = await getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error("La sesión del dispositivo expiró. Entra con el PIN cuando tengas conexión.");
  const response = await fetch(BIOMETRIC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": SUPABASE_KEY },
    body: JSON.stringify({ action, ...extra })
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.error) throw new Error(result.error || "No se pudo verificar la autenticación biométrica.");
  return result;
}
function serializeRegistrationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id, rawId: bufferToBase64url(credential.rawId), type: credential.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      transports: typeof response.getTransports === "function" ? response.getTransports() : ["internal"]
    }
  };
}
function serializeAuthenticationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id, rawId: bufferToBase64url(credential.rawId), type: credential.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null
    },
    clientExtensionResults: {}
  };
}
async function getBiometricAssertion(options, rpId, prfSalt) {
  const publicKey = {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    rpId,
    allowCredentials: (options.allowCredentials || []).map(item => ({ ...item, id: base64urlToBytes(item.id) })),
    userVerification: "required",
    extensions: { ...(options.extensions || {}), prf: { eval: { first: prfSalt } } }
  };
  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) throw new Error("No se completó la verificación biométrica.");
  return { credential, prfOutput: getPrfOutput(credential) };
}
async function refreshBiometricControls() {
  const unlockButton = $("#biometric-unlock"), unlockHint = $("#biometric-unlock-hint");
  const pinButton = $("#unlock-submit"), enableButton = $("#enable-biometric"), disableButton = $("#disable-biometric");
  const info = await getBiometricInfo().catch(() => null);
  const supported = Boolean(window.isSecureContext && navigator.credentials && window.PublicKeyCredential);
  if (unlockButton) unlockButton.hidden = !info || !supported;
  if (unlockHint) unlockHint.hidden = !info || !supported;
  if (pinButton) {
    pinButton.textContent = info && supported ? "Usar PIN como alternativa" : "Desbloquear con PIN";
    pinButton.classList.toggle("primary-button", !info || !supported);
    pinButton.classList.toggle("secondary-button", Boolean(info && supported));
  }
  if (enableButton) enableButton.hidden = !isUnlocked || !navigator.onLine || Boolean(info) || !supported;
  if (disableButton) disableButton.hidden = !isUnlocked || !navigator.onLine || !info;
  const description = $("#pairing-description");
  if (description && !isUnlocked && !$("#pin-unlock-form").hidden) {
    description.textContent = info && supported
      ? "Usa la huella dactilar o el PIN de respaldo de este celular."
      : "Introduce el PIN para entrar. Después podrás activar la huella si tu celular la admite.";
  }
  const statusEl = $("#biometric-status");
  if (statusEl) {
    statusEl.hidden = !(isUnlocked && info && !navigator.onLine);
    statusEl.textContent = "Huella configurada. Sin conexión puedes abrir la copia local; para sincronizar necesitarás recuperar Internet.";
  }
}
async function handleBiometricUnlock() {
  const button = $("#biometric-unlock"), error = $("#unlock-error");
  button.disabled = true; error.hidden = true;
  let serverAuthorized = false;
  try {
    if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) throw new Error("Este navegador no admite autenticación biométrica segura.");
    const info = await getBiometricInfo();
    if (!info) throw new Error("Primero debes activar la huella desde la configuración del operador.");
    let prfOutput;
    if (navigator.onLine) {
      const result = await biometricApi("authentication-options");
      const assertion = await getBiometricAssertion(result.options, info.rpId, base64urlToBytes(info.prfSalt));
      await biometricApi("authentication-verify", { credential: serializeAuthenticationCredential(assertion.credential) });
      serverAuthorized = true;
      prfOutput = assertion.prfOutput;
    } else {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({ publicKey: {
        challenge, rpId: info.rpId, timeout: 60000, userVerification: "required",
        allowCredentials: [{ type: "public-key", id: base64urlToBytes(info.credentialId) }],
        extensions: { prf: { eval: { first: base64urlToBytes(info.prfSalt) } } }
      } });
      if (!assertion) throw new Error("No se completó la verificación biométrica.");
      prfOutput = getPrfOutput(assertion);
    }
    const vault = await unlockVaultWithBiometric(prfOutput);
    if (navigator.onLine) {
      if (!user?.id || vault.userId !== user.id || (ownerId && vault.ownerId !== ownerId)) throw new Error("La copia local no corresponde al dispositivo vinculado.");
      ownerId = vault.ownerId;
      offlineMode = false;
    } else {
      user = { id: vault.userId, is_anonymous: true }; ownerId = vault.ownerId; offlineMode = true;
    }
    customers = vault.customers || []; loans = vault.loans || [];
    isUnlocked = true; lastTouch = Date.now(); render();
    if (navigator.onLine) {
      try {
        await syncPending(); await loadData(); showApp(true); status("Huella verificada. Dispositivo desbloqueado y sincronizado.", true);
      } catch {
        offlineMode = true; await loadLocalData(); showApp(true); status("Huella verificada. Los registros locales se conservaron; la sincronización queda pendiente.");
      }
    } else {
      showApp(true); status("Huella verificada. Modo sin conexión: los cambios se guardan cifrados en este dispositivo.");
    }
    armIdleLock(); await refreshBiometricControls();
  } catch (ex) {
    if (serverAuthorized) { try { const sb = await getSupabase(); await sb.rpc("lock_operator_session"); } catch {} lockVault(); }
    error.textContent = ex.message || "No se pudo desbloquear con la huella."; error.hidden = false;
  } finally { button.disabled = false; }
}
async function handleBiometricSetup() {
  const button = $("#enable-biometric"), statusEl = $("#biometric-status");
  button.disabled = true; statusEl.hidden = false; statusEl.textContent = "Preparando autenticación segura…";
  let credentialRegistered = false;
  try {
    if (!isUnlocked || !navigator.onLine) throw new Error("Desbloquea la aplicación con el PIN y conéctate a Internet para activar la huella.");
    if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) throw new Error("Este navegador no ofrece WebAuthn en un contexto seguro.");
    const response = await biometricApi("registration-options");
    const options = response.options;
    const publicKey = {
      ...options,
      challenge: base64urlToBytes(options.challenge),
      user: { ...options.user, id: base64urlToBytes(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: base64urlToBytes(item.id) })),
      extensions: { ...(options.extensions || {}), prf: {} }
    };
    const created = await navigator.credentials.create({ publicKey });
    if (!created) throw new Error("No se completó el registro de la huella.");
    await biometricApi("registration-verify", { credential: serializeRegistrationCredential(created) });
    credentialRegistered = true;
    statusEl.textContent = "Huella registrada. Comprobando el cifrado biométrico…";
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const authOptions = await biometricApi("authentication-options");
    const assertion = await getBiometricAssertion(authOptions.options, location.hostname, salt);
    await biometricApi("authentication-verify", { credential: serializeAuthenticationCredential(assertion.credential) });
    await enableBiometricUnlock({ credentialId: created.id, rpId: location.hostname, prfSalt: salt, prfOutput: assertion.prfOutput });
    credentialRegistered = false;
    statusEl.textContent = "Huella activada. La próxima vez podrás desbloquear con biometría o usar el PIN como respaldo.";
    statusEl.hidden = false; status("Autenticación biométrica activada correctamente.", true);
    await refreshBiometricControls();
  } catch (ex) {
    if (credentialRegistered) { try { await biometricApi("remove"); } catch {} }
    statusEl.textContent = ex.message || "No se pudo activar la huella. El PIN sigue funcionando.";
    statusEl.hidden = false;
  } finally { button.disabled = false; }
}
async function handleBiometricRemoval() {
  const button = $("#disable-biometric"), statusEl = $("#biometric-status");
  button.disabled = true;
  try {
    await biometricApi("remove");
    await disableBiometricUnlock();
    statusEl.textContent = "Huella desactivada. El PIN sigue protegiendo la copia local.";
    statusEl.hidden = false; status("Autenticación biométrica desactivada.", true);
    await refreshBiometricControls();
  } catch (ex) {
    statusEl.textContent = ex.message || "No se pudo desactivar la huella."; statusEl.hidden = false;
  } finally { button.disabled = false; }
}
const $ = s => document.querySelector(s);
const money = cents => formatCordobas(Number(cents || 0));
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date = value => new Intl.DateTimeFormat("es-NI",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Managua"}).format(new Date(value));
function todayLocalDate(){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Managua",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const part=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return part.year+"-"+part.month+"-"+part.day;
}
function dateInputTimestamp(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))throw new Error("Selecciona una fecha válida.");
 const parsed=new Date(value+"T12:00:00-06:00");
 if(Number.isNaN(parsed.getTime()))throw new Error("La fecha indicada no es válida.");
 return parsed.toISOString();
}
function displayDay(value){
 if(!value)return "—";
 const raw=String(value);
 const normalized=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+"T12:00:00-06:00":raw;
 return new Intl.DateTimeFormat("es-NI",{dateStyle:"medium",timeZone:"America/Managua"}).format(new Date(normalized));
}
function syncDateFieldState(input){if(input)input.classList.toggle("date-empty",!input.value)}
for(const selector of ["#loan-date","#payment-date"]){
 const input=$(selector);
 input.addEventListener("input",()=>syncDateFieldState(input));
 input.addEventListener("change",()=>syncDateFieldState(input));
 syncDateFieldState(input);
}
const PAIR_KEY="control-prestamos-pending-operator-pair";
let user=null,ownerId=null,loans=[],customers=[],entryType="loan",selectedLoanId=null,isUnlocked=false,offlineMode=false,idleTimer=null,lastTouch=0;
const query=new URLSearchParams(location.search);
const inviteFromUrl=query.get("pair");
if(inviteFromUrl){sessionStorage.setItem(PAIR_KEY,inviteFromUrl);const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete("pair");history.replaceState({},"",cleanUrl.pathname+cleanUrl.hash);}
function status(message,ok=false){const el=$("#connection-status");if(el){el.textContent=message;el.style.borderColor=ok?"#b7e7ce":"#f0d9a6";el.style.background=ok?"#f0fff6":"#fff9e9"}const notice=$("#offline-status");if(notice){notice.textContent=message;notice.hidden=!(offlineMode||/pendiente|sin conexión|offline/i.test(message));const retry=$("#retry-sync");if(retry)retry.hidden=!(offlineMode&&isUnlocked&&navigator.onLine)}}
function showApp(show){document.querySelectorAll(".operator-app-only").forEach(n=>{n.hidden=!show||n.classList.contains("keep-hidden-until-action")});$("#pairing-panel").hidden=show;$("#lock-operator").hidden=!show;void refreshBiometricControls()}
function toast(message){const el=$("#toast");el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,3000)}
async function sha256Hex(value){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
function balance(loan){return Math.max(0,Number(loan.total_due_cents)-Number(loan.paid_cents||0))}
function parseMoney(raw){const cleaned=String(raw).replace(/C\$/gi,"").replace(/\s/g,"").replace(/,/g,"");if(!/^\d+(\.\d{0,2})?$/.test(cleaned))throw new Error("Escribe un monto válido, por ejemplo C$ 1,250.00.");return toCents(cleaned)}
function updatePreview(){
 const preview=$("#terms-preview");
 if(!preview)return;
 try{
  const cents=parseMoney($("#amount").value),months=Number($("#months").value);
  if(!cents||!Number.isInteger(months)||months<1||months>120){preview.textContent="";preview.hidden=true;return}
  const terms=calculateLoanTerms(cents,months);
  const installment=calculateMonthlyReferenceCents(terms.totalDueCents,months);
  preview.textContent="Interés total: "+money(terms.interestCents)+" · Total a devolver: "+money(terms.totalDueCents)+" · Cuota mensual de referencia: "+money(installment)+".";
  preview.hidden=false;
 }catch{preview.textContent="";preview.hidden=true}
}
function render(){
 const active=loans.filter(l=>balance(l)>0);
 $("#outstanding-total").textContent=money(loans.reduce((s,l)=>s+balance(l),0));
 $("#active-count").textContent=String(active.length);
 const q=$("#search").value.trim().toLocaleLowerCase("es");
 const rows=loans.filter(l=>(l.customers?.full_name||"").toLocaleLowerCase("es").includes(q));
 $("#empty-state").hidden=rows.length>0;
 $("#empty-state").textContent=q?"No hay resultados para esa búsqueda.":"No hay préstamos registrados. Usa «Registrar préstamo» para comenzar.";
 $("#record-list").innerHTML=rows.map(l=>{
  const name=l.customers?.full_name||"Cliente";
  const phone=String(l.customers?.phone||"").trim();
  const loanDate=displayDay(l.loan_date||l.created_at);
  const installment=calculateMonthlyReferenceCents(Number(l.total_due_cents||l.principal_cents),Number(l.term_months||1));
  const payments=[...(l.payments||[])].sort((a,b)=>new Date(b.paid_at)-new Date(a.paid_at));
  const paymentHistory=payments.length?'<ul class="payment-history-list">'+payments.map(p=>'<li><span>'+esc(displayDay(p.paid_at))+'</span><strong>'+money(Number(p.amount_cents||0))+'</strong>'+(p.note?'<small>'+esc(p.note)+'</small>':'')+'</li>').join("")+'</ul>':'<p class="muted-copy">Todavía no hay abonos registrados.</p>';
  return '<article class="record-card"><div class="record-avatar" aria-hidden="true">'+esc(name.slice(0,1).toUpperCase())+'</div><div class="record-main"><h3>'+esc(name)+'</h3><small>Préstamo: '+esc(loanDate)+' · '+Number(l.term_months)+' mes(es)</small><div class="detail-extra" id="detail-'+esc(l.id)+'" hidden><p>Fecha del préstamo: <strong>'+esc(loanDate)+'</strong></p>'+(phone?'<p>Teléfono: <strong>'+esc(phone)+'</strong></p>':'')+'<p>Capital: <strong>'+money(Number(l.principal_cents||0))+'</strong></p><p>Interés total (15% simple mensual): <strong>'+money(Number(l.interest_cents||0))+'</strong></p><p>Total acordado: <strong>'+money(Number(l.total_due_cents||0))+'</strong></p><p>Cuota mensual de referencia: <strong>'+money(installment)+'</strong></p><p>Total abonado: <strong>'+money(Number(l.paid_cents||0))+'</strong></p><p>Saldo pendiente: <strong>'+money(balance(l))+'</strong></p>'+(l.note?'<p>Nota: '+esc(l.note)+'</p>':'')+'<div class="payment-history"><h4>Abonos registrados ('+payments.length+')</h4>'+paymentHistory+'</div></div></div><div class="record-balance"><span>Saldo pendiente</span><strong>'+money(balance(l))+'</strong><div class="record-actions"><button class="small-pay-button" data-pay="'+esc(l.id)+'" type="button" '+(balance(l)<=0?'disabled':'')+' aria-label="Registrar abono">＋ Abono</button><button class="small-icon-button" data-view="'+esc(l.id)+'" type="button" aria-label="Ver detalle" title="Ver detalle">◉</button><select class="record-menu" data-menu="'+esc(l.id)+'" aria-label="Más opciones"><option value="">Opciones</option><option value="repeat">Prestar de nuevo</option><option value="payments">Ver abonos</option></select></div></div></article>';
 }).join("");
}
async function loadLocalData(){const vault=getVault();ownerId=vault.ownerId;customers=vault.customers||[];loans=vault.loans||[];render();return vault}
async function loadData(){const sb=await getSupabase();const [loanResult,customerResult]=await Promise.all([sb.from("loans").select("*, customers(full_name,phone), payments(id,amount_cents,paid_at,note)").eq("owner_id",ownerId).order("created_at",{ascending:false}),sb.from("customers").select("id,owner_id,full_name,phone,notes,created_at,updated_at").eq("owner_id",ownerId).order("created_at",{ascending:false})]);if(loanResult.error)throw loanResult.error;if(customerResult.error)throw customerResult.error;loans=(loanResult.data||[]).map(l=>({...l,paid_cents:(l.payments||[]).reduce((s,p)=>s+Number(p.amount_cents),0)}));customers=customerResult.data||[];const vault=getVault();await saveVault({...vault,customers,loans,lastSyncAt:new Date().toISOString()});render()}
async function syncPending(){if(!navigator.onLine||offlineMode)throw new TypeError("Sin conexión segura para sincronizar.");const sb=await getSupabase();while(true){const vault=getVault();if(!vault.queue.length){await saveVault({...vault,lastSyncAt:new Date().toISOString()});return}const op=vault.queue[0];const {error}=await sb.from(op.entity).upsert(op.record,{onConflict:"id"});if(error)throw error;await saveVault({...vault,queue:vault.queue.slice(1),lastSyncAt:new Date().toISOString()});status("Sincronizando registros pendientes…")}}
function openForm(type,loan=null){
 entryType=type;selectedLoanId=loan?.id||null;
 const isPayment=type==="payment",isRepeat=type==="repeat";
 $("#entry-title").textContent=type==="loan"?"Registrar préstamo":isRepeat?"Prestar de nuevo":"Registrar abono";
 // Start every capture field empty; a linked loan is identified by context, not prefilled inputs.
 $("#client-name").value="";$("#client-name").readOnly=false;$("#client-name").required=type==="loan";
 $("#client-phone").value="";$("#client-phone").readOnly=false;
 $("#client-name-field").hidden=isPayment||isRepeat;
 $("#client-phone-field").hidden=isPayment||isRepeat;
 const context=$("#selected-client-context");
 context.hidden=!(isPayment||isRepeat);
 context.textContent=isPayment
  ?"Este abono se aplicará al préstamo de "+(loan?.customers?.full_name||"este cliente")+"."
  :"El nuevo préstamo se asociará al cliente "+(loan?.customers?.full_name||"seleccionado")+".";
 $("#loan-date-field").hidden=isPayment;
 $("#payment-date-field").hidden=!isPayment;
 $("#loan-date").required=!isPayment;$("#payment-date").required=isPayment;
 $("#loan-date").max=todayLocalDate();$("#payment-date").max=todayLocalDate();
 $("#loan-date").value="";$("#payment-date").value="";syncDateFieldState($("#loan-date"));syncDateFieldState($("#payment-date"));
 $("#months-field").hidden=isPayment;$("#months").required=!isPayment;$("#months").value="";
 $("#terms-preview").hidden=isPayment;$("#amount").value="";$("#entry-note").value="";
 $("#form-error").hidden=true;updatePreview();$("#entry-panel").hidden=false;
 if(!isPayment&&!isRepeat)$("#client-name").focus();
 else $("#amount").focus();
 $("#entry-panel").scrollIntoView({behavior:"smooth",block:"start"});
}
function closeForm(){$("#entry-panel").hidden=true;$("#client-name").readOnly=false;selectedLoanId=null}
async function saveEntry(event){
 event.preventDefault();const error=$("#form-error");error.hidden=true;const submit=event.submitter;submit.disabled=true;
 try{
  const amountCents=parseMoney($("#amount").value),note=$("#entry-note").value.trim(),months=Number($("#months").value),now=new Date().toISOString();
  if(amountCents<=0)throw new Error("El monto debe ser mayor que cero.");
  if(entryType!=="payment"&&(!Number.isInteger(months)||months<1||months>120))throw new Error("El plazo debe ser de 1 a 120 meses.");
  const loanDate=$("#loan-date").value,paidAt=$("#payment-date").value?dateInputTimestamp($("#payment-date").value):now;
  if(entryType==="payment"&&!$("#payment-date").value)throw new Error("Selecciona la fecha del abono.");
  if(entryType==="payment"&&$("#payment-date").value>todayLocalDate())throw new Error("La fecha del abono no puede estar en el futuro.");
  if(entryType!=="payment"&&!loanDate)throw new Error("Selecciona la fecha del préstamo.");
  if(entryType!=="payment"&&loanDate>todayLocalDate())throw new Error("La fecha del préstamo no puede estar en el futuro.");
  const vault=getVault();const nextCustomers=[...(vault.customers||[])];const nextLoans=[...(vault.loans||[])];const queue=[...(vault.queue||[])];
  if(entryType==="payment"){
   const loan=nextLoans.find(l=>l.id===selectedLoanId);if(!loan)throw new Error("No se identificó el préstamo exacto.");
   if(amountCents>balance(loan))throw new Error("El abono no puede superar el saldo pendiente.");
   const payment={id:crypto.randomUUID(),owner_id:ownerId,loan_id:loan.id,amount_cents:amountCents,note,paid_at:paidAt,created_at:now};
   loan.payments=[...(loan.payments||[]),payment];loan.paid_cents=Number(loan.paid_cents||0)+amountCents;
   queue.push({id:payment.id,entity:"payments",record:payment,createdAt:now});
  }else{
   let customerId,customerName;
   const fullName=$("#client-name").value.trim(),phone=$("#client-phone").value.trim();
   if(entryType==="repeat"){
    const source=nextLoans.find(l=>l.id===selectedLoanId);customerId=source?.customer_id;customerName=source?.customers?.full_name;
    if(!customerId)throw new Error("No se encontró el cliente del préstamo anterior.");
   }else{
    if(!fullName)throw new Error("Escribe el nombre del cliente.");
    const existing=nextCustomers.find(c=>String(c.full_name||"").trim().toLocaleLowerCase("es-NI")===fullName.toLocaleLowerCase("es-NI"));
    if(existing){
     customerId=existing.id;customerName=existing.full_name;
     if(phone&&phone!==String(existing.phone||"")){
      const updated={...existing,phone,updated_at:now};const idx=nextCustomers.findIndex(c=>c.id===existing.id);nextCustomers[idx]=updated;
      const pendingIndex=queue.findIndex(op=>op.entity==="customers"&&op.record.id===existing.id);
      if(pendingIndex>=0)queue[pendingIndex]={id:existing.id,entity:"customers",record:updated,createdAt:now};
      else queue.push({id:existing.id,entity:"customers",record:updated,createdAt:now});
     }
    }else{
     const customer={id:crypto.randomUUID(),owner_id:ownerId,full_name:fullName,phone:phone||null,notes:null,created_at:now,updated_at:now};
     customerId=customer.id;customerName=customer.full_name;nextCustomers.unshift(customer);
     queue.push({id:customer.id,entity:"customers",record:customer,createdAt:now});
    }
   }
   const terms=calculateLoanTerms(amountCents,months);
   const record={id:crypto.randomUUID(),owner_id:ownerId,customer_id:customerId,loan_date:loanDate,principal_cents:amountCents,term_months:months,monthly_rate:terms.monthlyRate,interest_cents:terms.interestCents,total_due_cents:terms.totalDueCents,note,status:"active",created_at:now,updated_at:now};
   nextLoans.unshift({...record,customers:{full_name:customerName,phone:phone||nextCustomers.find(c=>c.id===customerId)?.phone||null},payments:[],paid_cents:0});
   queue.push({id:record.id,entity:"loans",record,createdAt:now});
  }
  await saveVault({...vault,customers:nextCustomers,loans:nextLoans,queue});
  customers=nextCustomers;loans=nextLoans;render();closeForm();
  if(navigator.onLine&&!offlineMode){
   try{await syncPending();await loadData();status("Guardado y sincronizado.",true);toast(entryType==="payment"?"Abono registrado y sincronizado.":"Préstamo registrado y sincronizado.");}
   catch(syncError){offlineMode=true;await loadLocalData();const pending=getVault().queue.length;if(pending){status("Registro guardado en este dispositivo; la sincronización está pendiente.");toast("Guardado localmente. Pendiente de sincronización.");}else{status("El registro está guardado, pero no se pudo actualizar la lista desde el servidor. Reintenta con tu PIN.");toast("Datos locales conservados; falta confirmar la actualización.");}}
  }else{status("Registro guardado en este dispositivo; pendiente de sincronización.");toast("Guardado localmente. Pendiente de sincronización.");}
 }catch(ex){error.textContent=ex.message||"No se pudo guardar el movimiento.";error.hidden=false}
 finally{submit.disabled=false}
}
async function handleSetupPair(event){
 event.preventDefault();const err=$("#pair-error");err.hidden=true;
 const pin=$("#new-pin").value,confirmPin=$("#confirm-pin").value;
 if(!/^\d{4,6}$/.test(pin)){err.textContent="El PIN debe tener entre 4 y 6 números.";err.hidden=false;return}
 if(pin!==confirmPin){err.textContent="Los dos PIN no coinciden.";err.hidden=false;return}
 const token=sessionStorage.getItem(PAIR_KEY);if(!token){err.textContent="El enlace ya no está disponible. Pide otro al propietario.";err.hidden=false;return}
 const button=$("#pair-submit");button.disabled=true;
 try{
  const sb=await getSupabase();const {data,error}=await sb.rpc("redeem_operator_pairing",{p_code_hash:await sha256Hex(token),p_device_name:"Dispositivo de papá",p_pin:pin});if(error)throw error;
  ownerId=Array.isArray(data)?data[0]?.owner_id:data?.owner_id;if(!ownerId)throw new Error("No se pudo confirmar el vínculo con el propietario.");
  await createVault(pin,{ownerId,userId:user.id,customers:[],loans:[],queue:[],lastSyncAt:null});
  sessionStorage.removeItem(PAIR_KEY);isUnlocked=true;offlineMode=false;lastTouch=Date.now();
  await loadData();showApp(true);status("Celular vinculado. Los registros locales quedarán cifrados con el PIN.",true);armIdleLock();
  $("#new-pin").value="";$("#confirm-pin").value="";
 }catch(ex){err.textContent=ex.message||"No se pudo vincular el celular.";err.hidden=false}
 finally{button.disabled=false}
}
async function unlockOffline(pin){
 const vault=await unlockVault(pin);user={id:vault.userId,is_anonymous:true};ownerId=vault.ownerId;customers=vault.customers||[];loans=vault.loans||[];offlineMode=true;isUnlocked=true;lastTouch=Date.now();render();showApp(true);status("Modo sin conexión. Los cambios se guardan cifrados en este dispositivo y se sincronizarán al reconectar.");armIdleLock();$("#operator-pin").value="";
}
async function handleUnlock(event){
 event.preventDefault();const err=$("#unlock-error");err.hidden=true;const pin=$("#operator-pin").value;const button=$("#unlock-submit");button.disabled=true;
 try{
  if(!navigator.onLine){await unlockOffline(pin);return}
  const sb=await getSupabase();
  const {data:{session},error:sessionError}=await sb.auth.getSession();if(sessionError)throw sessionError;
  if(session){user=session.user}else{const {data:anonymous,error:authError}=await sb.auth.signInAnonymously();if(authError)throw authError;user=anonymous.user}
  const {data,error}=await sb.rpc("verify_operator_pin",{p_pin:pin});if(error)throw error;
  if(data!==true){err.textContent="PIN incorrecto o acceso bloqueado temporalmente. Tras varios intentos, espera 5 minutos.";err.hidden=false;$("#operator-pin").value="";$("#operator-pin").focus();return}
  if(!user?.id||!user.is_anonymous)throw new Error("La identidad del dispositivo no es válida.");
  const {data:device,error:deviceError}=await sb.from("operator_devices").select("owner_id,is_active").eq("auth_user_id",user.id).maybeSingle();if(deviceError)throw deviceError;
  if(!device?.is_active)throw new Error("El propietario revocó este dispositivo. Pídele un enlace nuevo.");
  ownerId=device.owner_id;
  if(await hasVault()){
   const vault=await unlockVault(pin);
   if(vault.ownerId!==ownerId||vault.userId!==user.id)throw new Error("La copia local pertenece a otro dispositivo o propietario; no se modificó.");
  }else{
   await createVault(pin,{ownerId,userId:user.id,customers:[],loans:[],queue:[],lastSyncAt:null});
  }
  offlineMode=false;isUnlocked=true;lastTouch=Date.now();
  try{await syncPending();await loadData();showApp(true);status("Dispositivo desbloqueado y sincronizado.",true)}
  catch(syncError){offlineMode=true;await loadLocalData();showApp(true);const pending=getVault().queue.length;status(pending?"Acceso local habilitado. Hay registros pendientes; se conservaron y no se descartarán. Reintenta tras comprobar la conexión.":"La copia local está disponible, pero no se pudo actualizar la lista del servidor. Reintenta con tu PIN.");}
  armIdleLock();$("#operator-pin").value="";
 }catch(ex){
  if(isNetworkError(ex)&&await hasVault()){
   try{await unlockOffline(pin);status("Modo sin conexión. Los registros pendientes se conservarán hasta recuperar Internet.");}
   catch(localError){err.textContent=localError.message||"No se pudo abrir la copia local.";err.hidden=false}
  }else{err.textContent=ex.message||"No se pudo desbloquear.";err.hidden=false}
 }finally{button.disabled=false}
}
function showPairForm(type){showApp(false);$("#pair-setup-form").hidden=type!=="setup";$("#pin-unlock-form").hidden=type!=="unlock";$("#pair-error").hidden=true;$("#unlock-error").hidden=true;void refreshBiometricControls()}
function armIdleLock(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{void lockToPin("Se bloqueó por inactividad. Introduce el PIN para continuar.")},120000)}
async function lockToPin(message="Aplicación bloqueada."){
  clearTimeout(idleTimer);
  if(isUnlocked){isUnlocked=false;if(!offlineMode&&navigator.onLine){try{const sb=await getSupabase();await sb.rpc("lock_operator_session")}catch{}}}
  lockVault();loans=[];customers=[];selectedLoanId=null;$("#entry-panel").hidden=true;$("#operator-pin").value="";render();
  showPairForm("unlock");$("#pairing-title").textContent="Control Préstamos está bloqueado";$("#pairing-description").textContent="Tus registros están protegidos. Introduce el PIN para volver a entrar.";status(message);
}
async function noteActivity(){
  if(!isUnlocked)return;armIdleLock();
  if(offlineMode||!navigator.onLine)return;
  if(Date.now()-lastTouch>60000){lastTouch=Date.now();try{const sb=await getSupabase();const {data,error}=await sb.rpc("touch_operator_session");if(error||data!==true)await lockToPin("La sesión expiró. Introduce el PIN para continuar.")}catch{await lockToPin("La sesión expiró. Introduce el PIN para continuar.")}}
}
async function openOperatorSession(){
 if(!navigator.onLine){
  if(await hasVault()){offlineMode=true;showPairForm("unlock");$("#pairing-title").textContent="Control Préstamos sin conexión";$("#pairing-description").textContent="Introduce el PIN para abrir la copia local cifrada.";status("Sin conexión. Puedes trabajar con los registros guardados previamente.")}
  else{showPairForm("setup");$("#pair-setup-form").hidden=true;$("#pairing-title").textContent="Primera conexión necesaria";$("#pairing-description").textContent="Conéctate a Internet una vez para vincular el dispositivo y preparar el modo offline.";status("Este celular todavía no tiene una copia offline configurada.")}
  return;
 }
 const sb=await getSupabase();
 const {data:{session},error:sessionError}=await sb.auth.getSession();if(sessionError)throw sessionError;
 if(session){user=session.user}else{const {data,error}=await sb.auth.signInAnonymously();if(error)throw new Error("El acceso sin contraseña no está habilitado todavía. En Supabase, activa Authentication → Sign In / Providers → Anonymous Sign-Ins.");user=data.user}
 if(!user?.is_anonymous)throw new Error("Esta interfaz está pensada para el celular de papá. Ábrela en su dispositivo o en otro perfil del navegador.");
 const token=sessionStorage.getItem(PAIR_KEY);
 if(token){$("#pairing-title").textContent="Vincular este celular";$("#pairing-description").textContent="Crea un PIN que tu papá recuerde con facilidad. No necesita correo ni contraseña.";showPairForm("setup");status("Enlace seguro detectado. Crea tu PIN.");return}
 const {data:device,error}=await sb.from("operator_devices").select("owner_id,is_active").eq("auth_user_id",user.id).maybeSingle();
 if(error)throw error;
 if(!device){showPairForm("setup");$("#pair-setup-form").hidden=true;$("#pairing-title").textContent="Celular sin vincular";$("#pairing-description").textContent="Pide al propietario un enlace de vinculación. Después podrás entrar con un PIN sencillo.";status("Este celular todavía no está autorizado.");return}
 if(!device.is_active){showPairForm("setup");$("#pair-setup-form").hidden=true;$("#pairing-title").textContent="Acceso desactivado";$("#pairing-description").textContent="El propietario revocó este dispositivo. Pídele un enlace nuevo.";status("Dispositivo revocado.");return}
 ownerId=device.owner_id;await sb.rpc("lock_operator_session");showPairForm("unlock");$("#pairing-title").textContent="Desbloquea Control Préstamos";$("#pairing-description").textContent="Introduce el PIN de este celular. No hace falta recordar una contraseña de cuenta.";status("La app está bloqueada por seguridad.");
}
$("#pair-setup-form").addEventListener("submit",handleSetupPair);$("#retry-sync").addEventListener("click",()=>{void lockToPin("Vuelve a introducir tu PIN para autorizar la sincronización con el servidor.")});
$("#pin-unlock-form").addEventListener("submit",handleUnlock);
$("#biometric-unlock").addEventListener("click",handleBiometricUnlock);
$("#enable-biometric").addEventListener("click",handleBiometricSetup);
$("#disable-biometric").addEventListener("click",handleBiometricRemoval);
$("#lock-operator").addEventListener("click",()=>{void lockToPin("Aplicación bloqueada manualmente.")});
document.addEventListener("pointerdown",()=>{void noteActivity()},{passive:true});
document.addEventListener("keydown",()=>{void noteActivity()});
document.addEventListener("input",()=>{void noteActivity()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&isUnlocked)void lockToPin("La aplicación se bloqueó al quedar en segundo plano.")});
window.addEventListener("pagehide",()=>{if(user&&!offlineMode&&navigator.onLine)void getSupabase().then(sb=>sb.rpc("lock_operator_session")).catch(()=>{})});
window.addEventListener("offline",()=>{if(isUnlocked){offlineMode=true;status("Sin conexión. Los nuevos movimientos se guardarán localmente.");}});
window.addEventListener("online",()=>{if(isUnlocked&&offlineMode){void lockToPin("Conexión recuperada. Introduce tu PIN para verificar el dispositivo y sincronizar los movimientos pendientes.").then(()=>openOperatorSession()).catch(()=>{});}else if(!isUnlocked){void openOperatorSession().catch(async ex=>{if(await hasVault()){showPairForm("unlock");status("La conexión volvió, pero no se pudo contactar con el servidor. Puedes entrar localmente con tu PIN.");}else status(ex.message||"No se pudo conectar.");});}});
$("#entry-form").addEventListener("submit",saveEntry);$("#amount").addEventListener("blur",()=>{try{if($("#amount").value)$("#amount").value=money(parseMoney($("#amount").value))}catch{}});$("#amount").addEventListener("input",updatePreview);$("#months").addEventListener("input",updatePreview);
$("#show-loan-form").addEventListener("click",()=>openForm("loan"));$("#show-payment-form").addEventListener("click",()=>{const active=loans.filter(l=>balance(l)>0);if(active.length===1)openForm("payment",active[0]);else toast("Elige «＋ Abono» en el préstamo correspondiente.")});$("#close-form").addEventListener("click",closeForm);$("#cancel-form").addEventListener("click",closeForm);$("#search").addEventListener("input",render);
$("#record-list").addEventListener("click",e=>{const pay=e.target.closest("[data-pay]"),view=e.target.closest("[data-view]");if(pay){const loan=loans.find(l=>l.id===pay.dataset.pay);if(loan)openForm("payment",loan)}if(view){const details=$("#detail-"+CSS.escape(view.dataset.view));if(details)details.hidden=!details.hidden}});
$("#record-list").addEventListener("change",e=>{const menu=e.target.closest("[data-menu]");if(!menu||!menu.value)return;const loan=loans.find(l=>l.id===menu.dataset.menu);if(menu.value==="repeat")openForm("repeat",loan);if(menu.value==="payments"){const detail=$("#detail-"+CSS.escape(menu.dataset.menu));if(detail){detail.hidden=false;detail.scrollIntoView({behavior:"smooth",block:"nearest"})}}menu.value=""});
function setFontZoom(value){let desired=Number(value);if(!Number.isFinite(desired))desired=1;const scale=Math.max(.9,Math.min(1.3,Math.round(desired*10)/10));document.documentElement.style.zoom=String(scale);localStorage.setItem("control-prestamos-font-zoom",String(scale));$("#font-size-level").value=String(Math.round(scale*100));$("#font-size-value").textContent=String(Math.round(scale*100))+"%"}setFontZoom(Number(localStorage.getItem("control-prestamos-font-zoom")||1));$("#font-size-level").addEventListener("input",event=>setFontZoom(Number(event.currentTarget.value)/100));
openOperatorSession().catch(async ex=>{showApp(false);if(await hasVault()){offlineMode=true;showPairForm("unlock");$("#pairing-title").textContent="Control Préstamos sin conexión";$("#pairing-description").textContent="Introduce el PIN para abrir la copia local cifrada.";status("No se pudo contactar con el servidor. Puedes entrar con el PIN local.");}else{$("#pairing-title").textContent="No se pudo abrir el acceso";$("#pairing-description").textContent=ex.message||"No se pudo autorizar este dispositivo.";status(ex.message||"Error de conexión.");}});
