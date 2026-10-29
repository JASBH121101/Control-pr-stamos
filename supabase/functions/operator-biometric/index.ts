import { createClient } from "npm:@supabase/supabase-js@2";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "npm:@simplewebauthn/server@13.2.2";
const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const rpID="jasbh121101.github.io", origin="https://jasbh121101.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const b64d=(s:string)=>{s=s.replace(/-/g,"+").replace(/_/g,"/");const b=atob(s+"=".repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))};
const b64e=(a:Uint8Array)=>{let s="";for(const n of a)s+=String.fromCharCode(n);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Método no permitido."},405);
 if(req.headers.get("origin")!==origin)return json({error:"Origen no autorizado."},403);
 try{
  if(!service)return json({error:"Servicio biométrico no configurado."},503);
  const auth=req.headers.get("authorization")||"";
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user?.id||!user.is_anonymous)return json({error:"Dispositivo no autenticado."},401);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const store=async(action:string,p_payload:Record<string,unknown>={})=>{
    const {data,error}=await admin.rpc("operator_webauthn_store",{p_action:action,p_user_id:user.id,p_payload});
    if(error)throw error;return data;
  };
  const device=await store("device");
  if(!device?.is_active)return json({error:"Dispositivo no autorizado."},403);
  const body=await req.json(), action=body.action as string;
  const recentPin=async()=>{const state=await store("pin-session");if(!state?.valid)throw new Error("Por seguridad, desbloquea primero con tu PIN.")};
  const saveChallenge=async(purpose:string,challenge:string)=>{await store("save-challenge",{purpose,challenge,expires_at:new Date(Date.now()+120000).toISOString()})};
  const takeChallenge=async(purpose:string)=>{const row=await store("consume-challenge",{purpose});if(!row?.challenge)throw new Error("La verificación venció; intenta de nuevo.");return row.challenge as string};
  if(action==="registration-options"){
   await recentPin();
   if(await store("get-credential"))return json({error:"La huella ya está registrada."},409);
   const options=await generateRegistrationOptions({rpName:"Control Préstamos",rpID,userID:new TextEncoder().encode(user.id),userName:"operador-"+user.id.slice(0,8),userDisplayName:"Operador de Control Préstamos",attestationType:"none",timeout:60000,authenticatorSelection:{authenticatorAttachment:"platform",residentKey:"preferred",userVerification:"required"},supportedAlgorithmIDs:[-7,-257]});
   await saveChallenge("registration",options.challenge);return json({options});
  }
  if(action==="registration-verify"){
   await recentPin();const challenge=await takeChallenge("registration");
   const v=await verifyRegistrationResponse({response:body.credential,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
   if(!v.verified||!v.registrationInfo)throw new Error("No se pudo verificar la huella.");
   const c=v.registrationInfo.credential;
   await store("save-credential",{credential_id:c.id,public_key:b64e(c.publicKey),sign_count:c.counter,transports:c.transports||["internal"]});
   return json({verified:true});
  }
  if(action==="authentication-options"){
   const c=await store("get-credential");if(!c)return json({error:"Huella no configurada."},404);
   const options=await generateAuthenticationOptions({rpID,allowCredentials:[{id:c.credential_id,transports:c.transports||["internal"]}],userVerification:"required",timeout:60000});
   await saveChallenge("authentication",options.challenge);return json({options});
  }
  if(action==="authentication-verify"){
   const challenge=await takeChallenge("authentication"),c=await store("get-credential");if(!c)throw new Error("Huella no configurada.");
   const v=await verifyAuthenticationResponse({response:body.credential,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID,credential:{id:c.credential_id,publicKey:b64d(c.public_key),counter:Number(c.sign_count),transports:c.transports||["internal"]},requireUserVerification:true});
   if(!v.verified)throw new Error("Autenticación biométrica no verificada.");
   const state=await store("update-counter-unlock",{sign_count:v.authenticationInfo.newCounter});
   if(!state?.ok)throw new Error("El acceso está bloqueado temporalmente. Usa el PIN o espera a que termine el bloqueo.");
   return json({verified:true});
  }
  if(action==="remove"){await recentPin();await store("remove");return json({removed:true})}
  return json({error:"Acción desconocida."},400);
 }catch(e){return json({error:e instanceof Error?e.message:"Error biométrico."},400)}
});