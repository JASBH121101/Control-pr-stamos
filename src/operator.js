import { formatCordobas, toCents } from "./domain/loans.js";
import { hasVault, createVault, unlockVault, saveVault, getVault, lockVault } from "./offline-store.js";
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
  return !navigator.onLine || error instanceof TypeError || /failed to fetch|fetch failed|network|load failed|sin conexión|connection/i.test(String(error?.message || ""));
}
const $ = s => document.querySelector(s);
const money = cents => formatCordobas(Number(cents || 0));
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date = value => new Intl.DateTimeFormat("es-NI",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Managua"}).format(new Date(value));
const PAIR_KEY="control-prestamos-pending-operator-pair";
let user=null,ownerId=null,loans=[],customers=[],entryType="loan",selectedLoanId=null,isUnlocked=false,offlineMode=false,idleTimer=null,lastTouch=0;
const query=new URLSearchParams(location.search);
const inviteFromUrl=query.get("pair");
if(inviteFromUrl){sessionStorage.setItem(PAIR_KEY,inviteFromUrl);const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete("pair");history.replaceState({},"",cleanUrl.pathname+cleanUrl.hash);}
function status(message,ok=false){const el=$("#connection-status");if(el){el.textContent=message;el.style.borderColor=ok?"#b7e7ce":"#f0d9a6";el.style.background=ok?"#f0fff6":"#fff9e9"}const notice=$("#offline-status");if(notice){notice.textContent=message;notice.hidden=!(offlineMode||/pendiente|sin conexión|offline|sincroniz/i.test(message))}}
function showApp(show){document.querySelectorAll(".operator-app-only").forEach(n=>n.hidden=!show);$("#pairing-panel").hidden=show;$("#lock-operator").hidden=!show}
function toast(message){const el=$("#toast");el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,3000)}
async function sha256Hex(value){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
function balance(loan){return Math.max(0,Number(loan.total_due_cents)-Number(loan.paid_cents||0))}
function parseMoney(raw){const cleaned=String(raw).replace(/C\$/gi,"").replace(/\s/g,"").replace(/,/g,"");if(!/^\d+(\.\d{0,2})?$/.test(cleaned))throw new Error("Escribe un monto válido, por ejemplo C$ 1,250.00.");return toCents(cleaned)}
function updatePreview(){if($("#terms-preview").hidden)return;try{const cents=parseMoney($("#amount").value),months=Number($("#months").value);if(!cents||!Number.isInteger(months)||months<1||months>120){$("#terms-preview").textContent="Interés simple fijo: 15% mensual.";return}const interest=Math.round(cents*.15*months);$("#terms-preview").textContent=`Interés: ${money(interest)} · Total a devolver: ${money(cents+interest)}`}catch{$("#terms-preview").textContent="Interés simple fijo: 15% mensual."}}
function render(){const active=loans.filter(l=>balance(l)>0);$("#outstanding-total").textContent=money(loans.reduce((s,l)=>s+balance(l),0));$("#active-count").textContent=String(active.length);const q=$("#search").value.trim().toLocaleLowerCase("es");const rows=loans.filter(l=>(l.customers?.full_name||"").toLocaleLowerCase("es").includes(q));$("#empty-state").hidden=rows.length>0;$("#empty-state").textContent=q?"No hay resultados para esa búsqueda.":"No hay préstamos registrados. Usa «Registrar préstamo» para comenzar.";$("#record-list").innerHTML=rows.map(l=>{const name=l.customers?.full_name||"Cliente";return `<article class="record-card"><div class="record-avatar" aria-hidden="true">${esc(name.slice(0,1).toUpperCase())}</div><div class="record-main"><h3>${esc(name)}</h3><small>${Number(l.term_months)} mes(es) · ${date(l.created_at)}</small><div class="detail-extra" id="detail-${l.id}" hidden><p>Capital: ${money(l.principal_cents)}</p><p>Interés: ${money(l.interest_cents)}</p><p>Total acordado: ${money(l.total_due_cents)}</p><p>Abonado: ${money(l.paid_cents)}</p>${l.note?`<p>Nota: ${esc(l.note)}</p>`:""}</div></div><div class="record-balance"><span>Saldo pendiente</span><strong>${money(balance(l))}</strong><div class="record-actions"><button class="small-pay-button" data-pay="${l.id}" type="button" ${balance(l)<=0?"disabled":""} aria-label="Registrar abono">＋ Abono</button><button class="small-icon-button" data-view="${l.id}" type="button" aria-label="Ver detalle" title="Ver detalle">◉</button><select class="record-menu" data-menu="${l.id}" aria-label="Más opciones"><option value="">Opciones</option><option value="repeat">Prestar de nuevo</option><option value="payments">Ver abonos</option></select></div></div></article>`}).join("")}
async function loadLocalData(){const vault=getVault();ownerId=vault.ownerId;customers=vault.customers||[];loans=vault.loans||[];render();return vault}
async function loadData(){const sb=await getSupabase();const [loanResult,customerResult]=await Promise.all([sb.from("loans").select("*, customers(full_name), payments(id,amount_cents,paid_at,note)").eq("owner_id",ownerId).order("created_at",{ascending:false}),sb.from("customers").select("id,owner_id,full_name,phone,notes,created_at,updated_at").eq("owner_id",ownerId).order("created_at",{ascending:false})]);if(loanResult.error)throw loanResult.error;if(customerResult.error)throw customerResult.error;loans=(loanResult.data||[]).map(l=>({...l,paid_cents:(l.payments||[]).reduce((s,p)=>s+Number(p.amount_cents),0)}));customers=customerResult.data||[];const vault=getVault();await saveVault({...vault,customers,loans,lastSyncAt:new Date().toISOString()});render()}
async function syncPending(){if(!navigator.onLine||offlineMode)throw new TypeError("Sin conexión segura para sincronizar.");const sb=await getSupabase();while(true){const vault=getVault();if(!vault.queue.length){await saveVault({...vault,lastSyncAt:new Date().toISOString()});return}const op=vault.queue[0];const {error}=await sb.from(op.entity).upsert(op.record,{onConflict:"id",ignoreDuplicates:true});if(error)throw error;await saveVault({...vault,queue:vault.queue.slice(1),lastSyncAt:new Date().toISOString()});status("Sincronizando registros pendientes…")}}
function openForm(type,loan=null){entryType=type;selectedLoanId=loan?.id||null;$("#entry-title").textContent=type==="loan"?"Registrar préstamo":type==="repeat"?"Prestar de nuevo":"Registrar abono";$("#client-name").value=loan?.customers?.full_name||"";$("#client-name").readOnly=Boolean(loan);$("#months-field").hidden=type==="payment";$("#months").required=type!=="payment";$("#months").value="1";$("#terms-preview").hidden=type==="payment";$("#amount").value="";$("#entry-note").value="";$("#form-error").hidden=true;updatePreview();$("#entry-panel").hidden=false;$("#client-name").focus();$("#entry-panel").scrollIntoView({behavior:"smooth",block:"start"})}
function closeForm(){$("#entry-panel").hidden=true;$("#client-name").readOnly=false;selectedLoanId=null}
async function saveEntry(event){
 event.preventDefault();const error=$("#form-error");error.hidden=true;const submit=event.submitter;submit.disabled=true;
 try{
  const amountCents=parseMoney($("#amount").value),note=$("#entry-note").value.trim(),months=Number($("#months").value),now=new Date().toISOString();
  if(amountCents<=0)throw new Error("El monto debe ser mayor que cero.");
  if(entryType!=="payment"&&(!Number.isInteger(months)||months<1||months>120))throw new Error("El plazo debe ser de 1 a 120 meses.");
  const vault=getVault();const nextCustomers=[...(vault.customers||[])];const nextLoans=[...(vault.loans||[])];const queue=[...(vault.queue||[])];
  if(entryType==="payment"){
   const loan=nextLoans.find(l=>l.id===selectedLoanId);if(!loan)throw new Error("No se identificó el préstamo exacto.");
   if(amountCents>balance(loan))throw new Error("El abono no puede superar el saldo pendiente.");
   const payment={id:crypto.randomUUID(),owner_id:ownerId,loan_id:loan.id,amount_cents:amountCents,note,paid_at:now,created_at:now};
   loan.payments=[...(loan.payments||[]),payment];loan.paid_cents=Number(loan.paid_cents||0)+amountCents;
   queue.push({id:payment.id,entity:"payments",record:payment,createdAt:now});
  }else{
   let customerId,customerName;
   if(entryType==="repeat"){
    const source=nextLoans.find(l=>l.id===selectedLoanId);customerId=source?.customer_id;customerName=source?.customers?.full_name;
    if(!customerId)throw new Error("No se encontró el cliente del préstamo anterior.");
   }else{
    const fullName=$("#client-name").value.trim();if(!fullName)throw new Error("Escribe el nombre del cliente.");
    const existing=nextCustomers.find(c=>String(c.full_name||"").trim().toLocaleLowerCase("es-NI")===fullName.toLocaleLowerCase("es-NI"));
    if(existing){customerId=existing.id;customerName=existing.full_name}
    else{
     const customer={id:crypto.randomUUID(),owner_id:ownerId,full_name:fullName,notes:null,created_at:now,updated_at:now};
     customerId=customer.id;customerName=customer.full_name;nextCustomers.unshift(customer);
     queue.push({id:customer.id,entity:"customers",record:customer,createdAt:now});
    }
   }
   const interest=Math.round(amountCents*.15*months);
   const record={id:crypto.randomUUID(),owner_id:ownerId,customer_id:customerId,principal_cents:amountCents,term_months:months,monthly_rate:.15,interest_cents:interest,total_due_cents:amountCents+interest,note,status:"active",created_at:now,updated_at:now};
   nextLoans.unshift({...record,customers:{full_name:customerName},payments:[],paid_cents:0});
   queue.push({id:record.id,entity:"loans",record,createdAt:now});
  }
  await saveVault({...vault,customers:nextCustomers,loans:nextLoans,queue});
  customers=nextCustomers;loans=nextLoans;render();closeForm();
  if(navigator.onLine&&!offlineMode){
   try{await syncPending();await loadData();status("Guardado y sincronizado.",true);toast(entryType==="payment"?"Abono registrado y sincronizado.":"Préstamo registrado y sincronizado.");}
   catch(syncError){offlineMode=true;await loadLocalData();status("Registro guardado en este dispositivo; la sincronización está pendiente.");toast("Guardado localmente. Pendiente de sincronización.");}
  }else{
   status("Registro guardado en este dispositivo; pendiente de sincronización.");toast("Guardado localmente. Pendiente de sincronización.");
  }
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
  const {data,error}=await sb.rpc("verify_operator_pin",{p_pin:pin});if(error)throw error;
  if(data!==true){err.textContent="PIN incorrecto o acceso bloqueado temporalmente. Tras varios intentos, espera 5 minutos.";err.hidden=false;$("#operator-pin").value="";$("#operator-pin").focus();return}
  if(!user){const {data:{session},error:sessionError}=await sb.auth.getSession();if(sessionError)throw sessionError;user=session?.user||null}
  if(!user?.id)throw new Error("No se pudo recuperar la identidad del dispositivo. Recarga la aplicación con Internet.");
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
  catch(syncError){offlineMode=true;await loadLocalData();showApp(true);status("Acceso local habilitado. Hay registros pendientes; se conservaron y no se descartarán. Reintenta tras comprobar la conexión.");}
  armIdleLock();$("#operator-pin").value="";
 }catch(ex){
  if(isNetworkError(ex)&&await hasVault()){
   try{await unlockOffline(pin);status("Modo sin conexión. Los registros pendientes se conservarán hasta recuperar Internet.");}
   catch(localError){err.textContent=localError.message||"No se pudo abrir la copia local.";err.hidden=false}
  }else{err.textContent=ex.message||"No se pudo desbloquear.";err.hidden=false}
 }finally{button.disabled=false}
}
function showPairForm(type){showApp(false);$("#pair-setup-form").hidden=type!=="setup";$("#pin-unlock-form").hidden=type!=="unlock";$("#pair-error").hidden=true;$("#unlock-error").hidden=true}
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
$("#pair-setup-form").addEventListener("submit",handleSetupPair);
$("#pin-unlock-form").addEventListener("submit",handleUnlock);
$("#lock-operator").addEventListener("click",()=>{void lockToPin("Aplicación bloqueada manualmente.")});
document.addEventListener("pointerdown",()=>{void noteActivity()},{passive:true});
document.addEventListener("keydown",()=>{void noteActivity()});
document.addEventListener("input",()=>{void noteActivity()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&isUnlocked)void lockToPin("La aplicación se bloqueó al quedar en segundo plano.")});
window.addEventListener("pagehide",()=>{if(user&&!offlineMode&&navigator.onLine)void getSupabase().then(sb=>sb.rpc("lock_operator_session")).catch(()=>{})});
window.addEventListener("offline",()=>{if(isUnlocked){offlineMode=true;status("Sin conexión. Los nuevos movimientos se guardarán localmente.");}});
window.addEventListener("online",()=>{if(isUnlocked&&offlineMode){void lockToPin("Conexión recuperada. Introduce tu PIN para verificar el dispositivo y sincronizar los movimientos pendientes.");}else if(!isUnlocked){void openOperatorSession().catch(async ex=>{if(await hasVault()){showPairForm("unlock");status("La conexión volvió, pero no se pudo contactar con el servidor. Puedes entrar localmente con tu PIN.");}else status(ex.message||"No se pudo conectar.");});}});
$("#entry-form").addEventListener("submit",saveEntry);$("#amount").addEventListener("blur",()=>{try{if($("#amount").value)$("#amount").value=money(parseMoney($("#amount").value))}catch{}});$("#amount").addEventListener("input",updatePreview);$("#months").addEventListener("input",updatePreview);
$("#show-loan-form").addEventListener("click",()=>openForm("loan"));$("#show-payment-form").addEventListener("click",()=>{const active=loans.filter(l=>balance(l)>0);if(active.length===1)openForm("payment",active[0]);else toast("Elige «＋ Abono» en el préstamo correspondiente.")});$("#close-form").addEventListener("click",closeForm);$("#cancel-form").addEventListener("click",closeForm);$("#search").addEventListener("input",render);
$("#record-list").addEventListener("click",e=>{const pay=e.target.closest("[data-pay]"),view=e.target.closest("[data-view]");if(pay){const loan=loans.find(l=>l.id===pay.dataset.pay);if(loan)openForm("payment",loan)}if(view){const details=$("#detail-"+CSS.escape(view.dataset.view));if(details)details.hidden=!details.hidden}});
$("#record-list").addEventListener("change",e=>{const menu=e.target.closest("[data-menu]");if(!menu||!menu.value)return;const loan=loans.find(l=>l.id===menu.dataset.menu);if(menu.value==="repeat")openForm("repeat",loan);if(menu.value==="payments")toast((loan?.payments||[]).length?loan.payments.map(p=>date(p.paid_at)+" · "+money(p.amount_cents)).join(" | "):"Este préstamo todavía no tiene abonos.");menu.value=""});
function setFontZoom(value){const scale=Math.max(.9,Math.min(1.3,Math.round(value*100)/100));document.documentElement.style.zoom=String(scale);localStorage.setItem("control-prestamos-font-zoom",String(scale));$("#font-smaller").disabled=scale<=.9;$("#font-larger").disabled=scale>=1.3;$("#font-reset").disabled=scale===1}setFontZoom(Number(localStorage.getItem("control-prestamos-font-zoom")||1));$("#font-smaller").addEventListener("click",()=>setFontZoom(Number(document.documentElement.style.zoom||1)-.1));$("#font-reset").addEventListener("click",()=>setFontZoom(1));$("#font-larger").addEventListener("click",()=>setFontZoom(Number(document.documentElement.style.zoom||1)+.1));
openOperatorSession().catch(async ex=>{showApp(false);if(await hasVault()){offlineMode=true;showPairForm("unlock");$("#pairing-title").textContent="Control Préstamos sin conexión";$("#pairing-description").textContent="Introduce el PIN para abrir la copia local cifrada.";status("No se pudo contactar con el servidor. Puedes entrar con el PIN local.");}else{$("#pairing-title").textContent="No se pudo abrir el acceso";$("#pairing-description").textContent=ex.message||"No se pudo autorizar este dispositivo.";status(ex.message||"Error de conexión.");}});
