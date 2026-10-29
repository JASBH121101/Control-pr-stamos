import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.2.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RP_ID = "jasbh121101.github.io";
const EXPECTED_ORIGIN = "https://jasbh121101.github.io";
const ALLOWED_ORIGINS = new Set([EXPECTED_ORIGIN]);

const corsHeaders = {
  "Access-Control-Allow-Origin": EXPECTED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function fromBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function toBase64url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Solicitud biométrica no válida.");
  return value as Record<string, any>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origen no autorizado." }, 403);

  try {
    if (!SERVICE_ROLE_KEY) throw new Error("Falta configurar la clave de servicio de Supabase.");
    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Sesión no válida." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    const user = userResult?.user;
    if (userError || !user?.id || !user.is_anonymous) return json({ error: "Este acceso solo permite el dispositivo de operador ya vinculado." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: device, error: deviceError } = await admin
      .from("operator_devices")
      .select("owner_id,is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device?.is_active) return json({ error: "Este dispositivo no está autorizado por el propietario." }, 403);

    const body = asRecord(await req.json());
    const action = body.action as string;
    const nowIso = new Date().toISOString();

    async function requireRecentPinSession() {
      const { data: secret, error } = await admin
        .schema("private")
        .from("operator_device_secrets")
        .select("unlocked_until,locked_until")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      const now = Date.now();
      if (!secret?.unlocked_until || new Date(secret.unlocked_until).getTime() <= now ||
          (secret.locked_until && new Date(secret.locked_until).getTime() > now)) {
        throw new Error("Por seguridad, desbloquea primero con tu PIN y vuelve a intentar.");
      }
    }

    async function saveChallenge(purpose: "registration" | "authentication", challenge: string) {
      const { error } = await admin.schema("private").from("operator_webauthn_challenges").upsert({
        auth_user_id: user.id,
        purpose,
        challenge,
        expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      }, { onConflict: "auth_user_id" });
      if (error) throw error;
    }

    async function consumeChallenge(purpose: "registration" | "authentication") {
      const { data, error } = await admin.schema("private")
        .from("operator_webauthn_challenges")
        .delete()
        .eq("auth_user_id", user.id)
        .eq("purpose", purpose)
        .gt("expires_at", nowIso)
        .select("challenge")
        .maybeSingle();
      if (error) throw error;
      if (!data?.challenge) throw new Error("La verificación venció. Intenta de nuevo.");
      return data.challenge as string;
    }

    if (action === "registration-options") {
      await requireRecentPinSession();
      const { data: existing, error } = await admin.schema("private")
        .from("operator_webauthn_credentials").select("auth_user_id")
        .eq("auth_user_id", user.id).maybeSingle();
      if (error) throw error;
      if (existing) return json({ error: "Este celular ya tiene la huella configurada. Desactívala primero para volver a registrarla." }, 409);
      const options = await generateRegistrationOptions({
        rpName: "Control Préstamos",
        rpID: RP_ID,
        userID: new TextEncoder().encode(user.id),
        userName: "operador-" + user.id.slice(0, 8),
        userDisplayName: "Operador de Control Préstamos",
        attestationType: "none",
        timeout: 60000,
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        supportedAlgorithmIDs: [-7, -257],
      });
      await saveChallenge("registration", options.challenge);
      return json({ options });
    }

    if (action === "registration-verify") {
      await requireRecentPinSession();
      const challenge = await consumeChallenge("registration");
      const response = asRecord(body.credential);
      const verification = await verifyRegistrationResponse({
        response: response as any,
        expectedChallenge: challenge,
        expectedOrigin: EXPECTED_ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: "No se pudo verificar la huella del dispositivo." }, 400);
      }
      const credential = verification.registrationInfo.credential;
      const { error } = await admin.schema("private").from("operator_webauthn_credentials").insert({
        auth_user_id: user.id,
        credential_id: credential.id,
        public_key: toBase64url(credential.publicKey),
        sign_count: credential.counter,
        transports: credential.transports || ["internal"],
      });
      if (error) throw error;
      return json({ verified: true });
    }

    if (action === "authentication-options") {
      const { data: credential, error } = await admin.schema("private")
        .from("operator_webauthn_credentials")
        .select("credential_id,transports")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!credential) return json({ error: "Este celular todavía no tiene huella configurada." }, 404);
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: [{ id: credential.credential_id, transports: credential.transports || ["internal"] }],
        userVerification: "required",
        timeout: 60000,
      });
      await saveChallenge("authentication", options.challenge);
      return json({ options });
    }

    if (action === "authentication-verify") {
      const challenge = await consumeChallenge("authentication");
      const { data: credential, error } = await admin.schema("private")
        .from("operator_webauthn_credentials")
        .select("credential_id,public_key,sign_count,transports")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!credential) return json({ error: "La huella no está registrada para este celular." }, 404);
      const verification = await verifyAuthenticationResponse({
        response: asRecord(body.credential) as any,
        expectedChallenge: challenge,
        expectedOrigin: EXPECTED_ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: credential.credential_id,
          publicKey: fromBase64url(credential.public_key),
          counter: Number(credential.sign_count),
          transports: credential.transports || ["internal"],
        },
        requireUserVerification: true,
      });
      if (!verification.verified) return json({ error: "La autenticación biométrica no fue verificada." }, 401);
      const { error: credentialUpdateError } = await admin.schema("private")
        .from("operator_webauthn_credentials")
        .update({ sign_count: verification.authenticationInfo.newCounter, updated_at: new Date().toISOString() })
        .eq("auth_user_id", user.id);
      if (credentialUpdateError) throw credentialUpdateError;
      const { error: sessionUpdateError } = await admin.schema("private")
        .from("operator_device_secrets")
        .update({ unlocked_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() })
        .eq("auth_user_id", user.id)
        .is("locked_until", null);
      if (sessionUpdateError) throw sessionUpdateError;
      const { error: deviceUpdateError } = await admin.from("operator_devices")
        .update({ last_seen_at: new Date().toISOString() }).eq("auth_user_id", user.id).eq("is_active", true);
      if (deviceUpdateError) throw deviceUpdateError;
      return json({ verified: true });
    }

    if (action === "remove") {
      await requireRecentPinSession();
      const { error } = await admin.schema("private").from("operator_webauthn_credentials")
        .delete().eq("auth_user_id", user.id);
      if (error) throw error;
      await admin.schema("private").from("operator_webauthn_challenges").delete().eq("auth_user_id", user.id);
      return json({ removed: true });
    }

    return json({ error: "Acción biométrica desconocida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la autenticación biométrica.";
    return json({ error: message }, 400);
  }
});
