import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { calculateLoanTerms, calculateMonthlyReferenceCents, formatCordobas, toCents } from "./domain/loans.js";

const SUPABASE_URL = "https://ctdcqwffzhpzgevqahob.supabase.co";
const SUPABASE_KEY = "sb_publishable_OV4MxEx5M-nRNQWnaOVXcA_B7YW8z73";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s) => document.querySelector(s);
let user = null, userRole = null, mode = "owner", entryType = "loan", selectedLoanId = null, loans = [], authMode = "login";
const OWNER_CLAIM_KEY = "control-prestamos-pending-owner-claim";
const ownerCodeFromUrl = new URLSearchParams(location.search).get("owner");
if (ownerCodeFromUrl) {
  localStorage.setItem(OWNER_CLAIM_KEY, ownerCodeFromUrl);
  const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete("owner");
  history.replaceState({}, "", cleanUrl.pathname + cleanUrl.hash);
}
const money = (cents) => formatCordobas(Number(cents || 0));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date = (v) => new Intl.DateTimeFormat("es-NI",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Managua"}).format(new Date(v));
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
function toast(message){const t=$("#toast");t.textContent=message;t.hidden=false;setTimeout(()=>t.hidden=true,3000)}
function setConnection(text,ok=false){$("#connection-status").innerHTML="<strong>Conexión:</strong> "+esc(text);$("#connection-status").style.borderColor=ok?"#b7e7ce":"#f0d9a6";$("#connection-status").style.background=ok?"#f0fff6":"#fff9e9"}
function showAuth(show){$("#auth-panel").hidden=!show;document.querySelectorAll(".app-only").forEach(n=>n.hidden=show);$("#signout-button").hidden=show}
function setAuthMode(next){authMode=next;$("#auth-title").textContent=next==="login"?"Inicia sesión":"Crear cuenta";$("#auth-description").textContent=next==="login"?"Entra para consultar tus registros sincronizados.":"Crea tu acceso privado. Usa un correo al que puedas acceder.";$("#auth-submit").textContent=next==="login"?"Iniciar sesión":"Crear cuenta";$("#toggle-auth-mode").textContent=next==="login"?"Crear cuenta":"Ya tengo cuenta";$("#auth-name").hidden=next==="login";$("#auth-name-label").hidden=next==="login";$("#auth-password").autocomplete=next==="login"?"current-password":"new-password";$("#auth-error").hidden=true}
async function sha256Hex(value) {
 const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
 return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}
async function claimOwnerIfPending() {
 const token = localStorage.getItem(OWNER_CLAIM_KEY);
 if (!token) return false;
 const { error } = await supabase.rpc("claim_control_prestamos_owner", { p_code_hash: await sha256Hex(token) });
 if (error) throw error;
 localStorage.removeItem(OWNER_CLAIM_KEY);
 return true;
}
async function ensureProfile() {
 const { data, error } = await supabase.from("profiles").select("id,role,display_name").eq("id", user.id).maybeSingle();
 if (error) throw error;
 if (!data) throw new Error("No se encontró el perfil de esta cuenta. Contacta al administrador.");
 userRole = data.role;
 if (userRole !== "owner") throw new Error("Esta cuenta no tiene acceso al panel propietario. Abre el enlace de configuración o inicia sesión con la cuenta propietaria.");
 return data;
}
function friendlyAuthError(error){
 const code=String(error?.code||error?.error_code||"").toLowerCase();
 const message=String(error?.message||"");
 const lower=message.toLowerCase();
 if(code==="email_not_confirmed"||lower.includes("email not confirmed")||lower.includes("email_not_confirmed")){
  return "Tu correo todavía no está confirmado. El enlace anterior venció o apuntaba a localhost; el acceso se rechaza hasta confirmar el correo con un enlace válido.";
 }
 if(code==="over_email_send_rate_limit"||lower.includes("email rate limit exceeded")||Number(error?.status)===429){
  return "Supabase limitó temporalmente el envío de correos por demasiados intentos (HTTP 429). No sigas creando cuentas ni solicitando enlaces por ahora. Espera a que se restablezca el límite; si persiste, habrá que configurar SMTP propio en Supabase.";
 }
 if(lower.includes("invalid login credentials"))return "El correo o la contraseña no coinciden.";
 if(lower.includes("para crear la cuenta propietaria"))return message;
 if(lower.includes("email address")&&lower.includes("invalid"))return "El formato del correo electrónico no es válido.";
 if(lower.includes("password")&&lower.includes("least"))return "La contraseña no cumple los requisitos mínimos.";
 return message||"No se pudo completar la operación de acceso.";
}
async function authSubmit(e) {
 e.preventDefault();
 const err = $("#auth-error"); err.hidden = true;
 const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
 $("#auth-submit").disabled = true;
 try {
  if (authMode === "login") {
   const { data, error } = await supabase.auth.signInWithPassword({ email, password });
   if (error) throw error;
   user = data.user;
  } else {
   if (!localStorage.getItem(OWNER_CLAIM_KEY)) throw new Error("Para crear la cuenta propietaria, abre primero el enlace seguro de configuración.");
   const emailRedirectTo = new URL("./", location.href).href;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { display_name: $("#auth-name").value.trim() || email.split("@")[0] } } });
   if (error) throw error;
   if (!data.session) {
    setAuthMode("login");
    err.textContent = "Cuenta creada. Confirma el correo y vuelve a esta página en el mismo navegador para activar el panel propietario.";
    err.hidden = false;
    return;
   }
   user = data.user;
  }
  await claimOwnerIfPending();
  await ensureProfile();
  showAuth(false); setMode("owner"); await loadData(); await loadOperatorDevices();
  setConnection("Conectado y sincronizado", true);
 } catch (ex) {
  err.textContent = friendlyAuthError(ex); err.hidden = false;
  if (user) { await supabase.auth.signOut(); user = null; userRole = null; showAuth(true); }
 } finally { $("#auth-submit").disabled = false; }
}
function balance(loan){return Math.max(0,Number(loan.total_due_cents)-Number(loan.paid_cents||0))}
function render(){
 const outstanding=loans.reduce((s,l)=>s+balance(l),0);
 const principal=loans.reduce((s,l)=>s+Number(l.principal_cents||0),0);
 const paid=loans.reduce((s,l)=>s+Number(l.paid_cents||0),0);
 const active=loans.filter(l=>balance(l)>0).length;
 $("#outstanding-total").textContent=money(outstanding);
 $("#active-count").textContent=String(active);
 $("#lent-total").textContent=money(principal);
 $("#paid-total").textContent=money(paid);
 const collectedInterest=loans.reduce((sum,l)=>sum+Math.max(0,Math.min(Number(l.interest_cents||0),Number(l.paid_cents||0)-Number(l.principal_cents||0))),0);
 $("#interest-collected").textContent=money(collectedInterest);
 $("#interest-expected").textContent=money(loans.reduce((s,l)=>s+(balance(l)>0?Math.max(0,Number(l.interest_cents||0)-Math.max(0,Number(l.paid_cents||0)-Number(l.principal_cents||0))):0),0));
 const q=$("#search").value.trim().toLocaleLowerCase("es");
 const filtered=loans.filter(l=>(l.customers?.full_name||"").toLocaleLowerCase("es").includes(q));
 $("#empty-state").hidden=filtered.length>0;
 $("#empty-state").textContent=q?"No hay resultados para esa búsqueda.":"No hay préstamos registrados. Usa «Registrar préstamo» para comenzar.";
 $("#record-list").innerHTML=filtered.map(l=>{
  const name=l.customers?.full_name||"Cliente";
  const loanDate=displayDay(l.loan_date||l.created_at);
  const phone=String(l.customers?.phone||"").trim();
  const installment=calculateMonthlyReferenceCents(Number(l.total_due_cents||l.principal_cents),Number(l.term_months||1));
  const payments=[...(l.payments||[])].sort((a,b)=>new Date(b.paid_at)-new Date(a.paid_at));
  const paymentHistory=payments.length
   ?'<ul class="payment-history-list">'+payments.map(p=>'<li><span>'+esc(displayDay(p.paid_at))+'</span><strong>'+money(Number(p.amount_cents||0))+'</strong>'+(p.note?'<small>'+esc(p.note)+'</small>':'')+'</li>').join("")+'</ul>'
   :'<p class="muted-copy">Todavía no hay abonos registrados.</p>';
  return '<article class="record-card"><div class="record-avatar" aria-hidden="true">'+esc(name.slice(0,1).toUpperCase())+'</div><div class="record-main"><h3>'+esc(name)+'</h3><small>Préstamo: '+esc(loanDate)+' · '+Number(l.term_months)+' mes(es)</small><div class="detail-extra" id="detail-'+esc(l.id)+'" hidden><p>Fecha del préstamo: <strong>'+esc(loanDate)+'</strong></p>'+(phone?'<p>Teléfono: <strong>'+esc(phone)+'</strong></p>':'')+'<p>Capital: <strong>'+money(Number(l.principal_cents||0))+'</strong></p><p>Interés total (15% simple mensual): <strong>'+money(Number(l.interest_cents||0))+'</strong></p><p>Total acordado: <strong>'+money(Number(l.total_due_cents||0))+'</strong></p><p>Cuota mensual de referencia: <strong>'+money(installment)+'</strong></p><p>Total abonado: <strong>'+money(Number(l.paid_cents||0))+'</strong></p><p>Saldo pendiente: <strong>'+money(balance(l))+'</strong></p>'+(l.note?'<p>Nota: '+esc(l.note)+'</p>':'')+'<div class="payment-history"><h4>Abonos registrados ('+payments.length+')</h4>'+paymentHistory+'</div></div></div><div class="record-balance"><span>Saldo pendiente</span><strong>'+money(balance(l))+'</strong><div class="record-actions"><button class="small-pay-button" data-pay="'+esc(l.id)+'" type="button" '+(balance(l)<=0?'disabled':'')+' aria-label="Registrar abono">＋ Abono</button><button class="small-icon-button" data-view="'+esc(l.id)+'" type="button" aria-label="Ver detalle" title="Ver detalle">◉</button><select class="record-menu" data-menu="'+esc(l.id)+'" aria-label="Más opciones"><option value="">Opciones</option><option value="repeat">Prestar de nuevo</option><option value="payments">Ver abonos</option></select></div></div></article>';
 }).join("");
 $("#history-list").innerHTML=loans.length?loans.map(l=>'<div class="history-row"><strong>'+esc(l.customers?.full_name||"Cliente")+'</strong><span>Préstamo: '+esc(displayDay(l.loan_date||l.created_at))+'</span><span>Capital: '+money(Number(l.principal_cents||0))+'</span><span>Abonos: '+money(Number(l.paid_cents||0))+'</span><span>Pendiente: '+money(balance(l))+'</span></div>').join(""):"<p>Sin movimientos registrados.</p>";
}
async function loadData(){const {data,error}=await supabase.from("loans").select("*, customers(full_name,phone), payments(id,amount_cents,paid_at,note)").order("created_at",{ascending:false});if(error)throw error;loans=(data||[]).map(l=>({...l,paid_cents:(l.payments||[]).reduce((s,p)=>s+Number(p.amount_cents),0)}));render()}
function openForm(type,loan=null){
 entryType=type;selectedLoanId=loan?.id||null;
 const isPayment=type==="payment";
 $("#entry-title").textContent=type==="loan"?"Registrar préstamo":type==="repeat"?"Prestar de nuevo":"Registrar abono";
 $("#client-name").value=loan?.customers?.full_name||"";
 $("#client-name").readOnly=Boolean(loan);
 $("#client-phone").value=loan?.customers?.phone||"";
 $("#client-phone").readOnly=Boolean(loan);
 $("#client-phone-field").hidden=isPayment;
 $("#loan-date-field").hidden=isPayment;
 $("#payment-date-field").hidden=!isPayment;
 $("#loan-date").required=!isPayment;
 $("#payment-date").required=isPayment;
 $("#loan-date").value=todayLocalDate();
 $("#payment-date").value=todayLocalDate();
 $("#months-field").hidden=isPayment;$("#months").required=!isPayment;$("#months").value="1";
 $("#terms-preview").hidden=isPayment;$("#amount").value="";$("#entry-note").value="";
 $("#form-error").hidden=true;updatePreview();$("#entry-panel").hidden=false;
 $("#client-name").focus();$("#entry-panel").scrollIntoView({behavior:"smooth",block:"start"});
}
function closeForm(){$("#entry-panel").hidden=true;$("#client-name").readOnly=false;selectedLoanId=null}
function parseMoney(raw){const cleaned=String(raw).replace(/C\$/gi,"").replace(/\s/g,"").replace(/,/g,"");if(!/^\d+(\.\d{0,2})?$/.test(cleaned))throw new Error("Escribe un monto válido, por ejemplo C$ 1,250.00.");return toCents(cleaned)}
function updatePreview(){if($("#terms-preview").hidden)return;try{const cents=parseMoney($("#amount").value),months=Number($("#months").value);if(!cents||!Number.isInteger(months)||months<1||months>120){$("#terms-preview").textContent="Interés simple fijo: 15% mensual.";return}const interest=Math.round(cents*.15*months);$("#terms-preview").textContent=`Interés: ${money(interest)} · Total a devolver: ${money(cents+interest)}`}catch{$("#terms-preview").textContent="Interés simple fijo: 15% mensual."}}
$("#amount").addEventListener("focus",()=>{if(!$("#amount").value)$("#amount").placeholder="C$ 0.00"});
$("#amount").addEventListener("blur",()=>{try{if($("#amount").value)$("#amount").value=money(parseMoney($("#amount").value))}catch{}});
$("#amount").addEventListener("input",updatePreview);$("#months").addEventListener("input",updatePreview);
$("#entry-form").addEventListener("submit",async e=>{
 e.preventDefault();
 const error=$("#form-error");error.hidden=true;
 const submit=e.submitter;submit.disabled=true;
 try{
  const amountCents=parseMoney($("#amount").value),note=$("#entry-note").value.trim();
  if(amountCents<=0)throw new Error("El monto debe ser mayor que cero.");
  if(entryType==="payment"){
   const loan=loans.find(l=>l.id===selectedLoanId);
   if(!loan)throw new Error("No se identificó el préstamo exacto.");
   if(amountCents>balance(loan))throw new Error("El abono no puede superar el saldo pendiente.");
   const paidAt=dateInputTimestamp($("#payment-date").value);
   const {error:paymentError}=await supabase.from("payments").insert({owner_id:user.id,loan_id:loan.id,amount_cents:amountCents,paid_at:paidAt,note});
   if(paymentError)throw paymentError;
  }else{
   const months=Number($("#months").value),loanDate=$("#loan-date").value;
   if(!loanDate)throw new Error("Selecciona la fecha del préstamo.");
   const customerName=$("#client-name").value.trim(),phone=$("#client-phone").value.trim();
   if(!customerName)throw new Error("Escribe el nombre del cliente.");
   let customerId;
   if(entryType==="repeat"){
    const source=loans.find(l=>l.id===selectedLoanId);customerId=source?.customer_id;
    if(!customerId)throw new Error("No se encontró el cliente.");
   }else{
    const {data:customer,error:customerError}=await supabase.from("customers").insert({owner_id:user.id,full_name:customerName,phone:phone||null,notes:null}).select("id").single();
    if(customerError)throw customerError;customerId=customer.id;
   }
   const terms=calculateLoanTerms(amountCents,months);
   const {error:loanError}=await supabase.from("loans").insert({owner_id:user.id,customer_id:customerId,loan_date:loanDate,principal_cents:amountCents,term_months:months,monthly_rate:terms.monthlyRate,interest_cents:terms.interestCents,total_due_cents:terms.totalDueCents,status:"active",note});
   if(loanError)throw loanError;
  }
  await loadData();closeForm();toast(entryType==="payment"?"Abono guardado con su fecha.":"Préstamo guardado y sincronizado.");
 }catch(ex){error.textContent=ex.message||"No se pudo guardar.";error.hidden=false}
 finally{submit.disabled=false}
});
$("#auth-form").addEventListener("submit",authSubmit);$("#toggle-auth-mode").addEventListener("click",()=>setAuthMode(authMode==="login"?"signup":"login"));
$("#toggle-password").addEventListener("click",()=>{const input=$("#auth-password"),button=$("#toggle-password"),show=input.type==="password";input.type=show?"text":"password";button.textContent=show?"Ocultar contraseña":"Mostrar contraseña";button.setAttribute("aria-pressed",String(show));});

$("#signout-button").addEventListener("click",async()=>{await supabase.auth.signOut();user=null;userRole=null;loans=[];showAuth(true);render();setConnection("Sesión cerrada")});
async function createOperatorInvite(){
 const err=$("#device-admin-error");err.hidden=true;
 try{
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  const token_hash=await sha256Hex(token);
  const {error}=await supabase.from("operator_pairing_codes").insert({owner_id:user.id,token_hash});
  if(error)throw error;
  const url=new URL("operador.html",location.href);url.searchParams.set("pair",token);
  $("#operator-invite-url").value=url.href;$("#operator-invite-panel").hidden=false;
  try{await navigator.clipboard.writeText(url.href);toast("Enlace generado y copiado. Compártelo únicamente con papá.");}catch{toast("Enlace generado. Usa el botón Copiar enlace.");}
  await loadOperatorDevices();
 }catch(ex){err.textContent=ex.message||"No se pudo generar el enlace.";err.hidden=false}
}
async function loadOperatorDevices(){
 const list=$("#operator-device-list");if(!list||!user)return;
 const {data,error}=await supabase.from("operator_devices").select("id,device_name,is_active,paired_at,last_seen_at").eq("owner_id",user.id).order("paired_at",{ascending:false});
 if(error){list.innerHTML='<p class="empty-state">No se pudieron cargar los dispositivos.</p>';return;}
 if(!data?.length){list.innerHTML='<p class="empty-state">Todavía no hay dispositivos vinculados.</p>';return;}
 list.innerHTML=data.map(d=>`<div class="device-row"><div><strong>${esc(d.device_name)}</strong><small>Vinculado: ${date(d.paired_at)}</small><small>${d.last_seen_at?"Última actividad: "+date(d.last_seen_at):"Sin actividad reciente"}</small></div><span class="device-status ${d.is_active?"":"revoked"}">${d.is_active?"ACTIVO":"REVOCADO"}</span>${d.is_active?`<button class="device-revoke" data-revoke-device="${d.id}" type="button">Revocar</button>`:""}</div>`).join("");
}
$("#create-operator-invite").addEventListener("click",createOperatorInvite);
$("#copy-operator-invite").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("#operator-invite-url").value);toast("Enlace copiado.")}catch{ $("#operator-invite-url").focus();$("#operator-invite-url").select();toast("Copia el enlace seleccionado.")}});
$("#refresh-operator-devices").addEventListener("click",loadOperatorDevices);
$("#operator-device-list").addEventListener("click",async e=>{const b=e.target.closest("[data-revoke-device]");if(!b)return;if(!confirm("¿Revocar el acceso de este dispositivo? Dejará de poder ver y modificar préstamos."))return;const {error}=await supabase.from("operator_devices").update({is_active:false}).eq("id",b.dataset.revokeDevice).eq("owner_id",user.id);if(error){toast("No se pudo revocar: "+error.message);return}toast("Acceso revocado.");await loadOperatorDevices()});

function setMode(next="owner"){
 mode="owner";
 document.body.classList.add("owner-mode");
 document.querySelectorAll(".owner-only").forEach(n=>n.hidden=false);
 const title=$("#page-title"), description=$("#page-description"), records=$("#records-title");
 if(title)title.textContent="Resumen de tu dinero";
 if(description)description.textContent="Consulta saldos, ganancias cobradas y movimientos registrados.";
 if(records)records.textContent="Cartera de préstamos";
 const label=document.querySelector(".owner-label"); if(label)label.hidden=false;
}
$("#show-loan-form").addEventListener("click",()=>openForm("loan"));$("#show-payment-form").addEventListener("click",()=>{const active=loans.filter(l=>balance(l)>0);if(active.length===1)openForm("payment",active[0]);else toast("Elige «＋ Abono» en el préstamo correspondiente.")});
$("#close-form").addEventListener("click",closeForm);$("#cancel-form").addEventListener("click",closeForm);$("#search").addEventListener("input",render);
$("#record-list").addEventListener("click",e=>{const pay=e.target.closest("[data-pay]"),view=e.target.closest("[data-view]");if(pay){const loan=loans.find(l=>l.id===pay.dataset.pay);if(loan)openForm("payment",loan)}if(view){const d=$("#detail-"+CSS.escape(view.dataset.view));if(d)d.hidden=!d.hidden}});
$("#record-list").addEventListener("change",e=>{const menu=e.target.closest("[data-menu]");if(!menu||!menu.value)return;const loan=loans.find(l=>l.id===menu.dataset.menu);if(menu.value==="repeat")openForm("repeat",loan);if(menu.value==="payments"){const detail=$("#detail-"+CSS.escape(menu.dataset.menu));if(detail){detail.hidden=false;detail.scrollIntoView({behavior:"smooth",block:"nearest"})}}menu.value=""});
async function start(){
 showAuth(true);setAuthMode("login");setConnection("Conectando…");
 try{
  const {data:{session},error}=await supabase.auth.getSession();if(error)throw error;
  if(session){
   user=session.user;
   await claimOwnerIfPending();
   await ensureProfile();
   showAuth(false);setMode("owner");await loadData();await loadOperatorDevices();
   setConnection("Conectado y sincronizado",true);
  }else{
   setConnection(localStorage.getItem(OWNER_CLAIM_KEY)?"Enlace de configuración listo. Crea tu cuenta propietaria.":"Listo. Usa el enlace seguro de configuración para crear la cuenta propietaria.",true);
  }
 }catch(ex){setConnection("Acceso no disponible: "+ex.message);$("#auth-error").textContent=ex.message;$("#auth-error").hidden=false;}
}
function setFontZoom(value){
 let desired=Number(value);if(!Number.isFinite(desired))desired=1;
 const scale=Math.max(.9,Math.min(1.3,Math.round(desired*10)/10));
 document.documentElement.style.zoom=String(scale);
 localStorage.setItem("control-prestamos-font-zoom",String(scale));
 $("#font-size-level").value=String(Math.round(scale*100));
 $("#font-size-value").textContent=String(Math.round(scale*100))+"%";
}
setFontZoom(Number(localStorage.getItem("control-prestamos-font-zoom")||1));
$("#font-size-level").addEventListener("input",event=>setFontZoom(Number(event.currentTarget.value)/100));
start();
