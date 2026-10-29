const DB_NAME = "control-prestamos-local";
const DB_VERSION = 1;
const VAULT_STORE = "vault";
const VAULT_ID = "primary";
const PBKDF2_ITERATIONS = 250000;

let activeKey = null;
let activeSalt = null;
let activeVault = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Este navegador no permite el almacenamiento local necesario."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(VAULT_STORE)) {
        request.result.createObjectStore(VAULT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir la base local."));
    request.onblocked = () => reject(new Error("Cierra otras pestañas de Control Préstamos e intenta de nuevo."));
  });
}

async function readVaultRecord() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE).get(VAULT_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("No se pudo leer la copia local."));
    });
  } finally {
    db.close();
  }
}

async function writeVaultRecord(record) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(VAULT_STORE, "readwrite");
      transaction.objectStore(VAULT_STORE).put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("No se pudo guardar la copia local."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló el guardado local."));
    });
  } finally {
    db.close();
  }
}

async function deriveKey(pin, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(pin)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault(key, salt, vault) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(vault));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    id: VAULT_ID,
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    updatedAt: new Date().toISOString()
  };
}

function normalizeVault(value) {
  return {
    version: 1,
    ownerId: value.ownerId || null,
    userId: value.userId || null,
    customers: Array.isArray(value.customers) ? value.customers : [],
    loans: Array.isArray(value.loans) ? value.loans : [],
    queue: Array.isArray(value.queue) ? value.queue : [],
    lastSyncAt: value.lastSyncAt || null,
    updatedAt: new Date().toISOString()
  };
}

export async function hasVault() {
  return Boolean(await readVaultRecord());
}

export async function createVault(pin, initialData) {
  if (!/^\d{4,6}$/.test(String(pin))) throw new Error("El PIN debe tener entre 4 y 6 números.");
  if (await hasVault()) throw new Error("Ya existe una copia local. No se sobrescribió para proteger los registros pendientes.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const vault = normalizeVault(initialData || {});
  await writeVaultRecord(await encryptVault(key, salt, vault));
  activeKey = key;
  activeSalt = salt;
  activeVault = vault;
  return clone(activeVault);
}

export async function unlockVault(pin) {
  const record = await readVaultRecord();
  if (!record) throw new Error("Este celular no tiene una copia offline configurada. Conéctate a Internet y desbloquea una vez.");
  try {
    const salt = base64ToBytes(record.salt);
    const key = await deriveKey(pin, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.ciphertext)
    );
    const vault = normalizeVault(JSON.parse(new TextDecoder().decode(decrypted)));
    if (!vault.ownerId || !vault.userId) throw new Error("La copia local no tiene el vínculo completo del dispositivo.");
    activeKey = key;
    activeSalt = salt;
    activeVault = vault;
    return clone(activeVault);
  } catch (error) {
    activeKey = null;
    activeSalt = null;
    activeVault = null;
    if (error instanceof Error && error.message.includes("vínculo completo")) throw error;
    throw new Error("El PIN no coincide con la copia local o los datos locales están dañados.");
  }
}

export async function saveVault(nextValue) {
  if (!activeKey || !activeSalt || !activeVault) {
    throw new Error("La copia local está bloqueada; desbloquea Control Préstamos antes de guardar.");
  }
  const nextVault = normalizeVault(nextValue);
  const record = await encryptVault(activeKey, activeSalt, nextVault);
  await writeVaultRecord(record);
  activeVault = nextVault;
  return clone(activeVault);
}

export function getVault() {
  if (!activeVault) throw new Error("La copia local está bloqueada.");
  return clone(activeVault);
}

export function lockVault() {
  activeKey = null;
  activeSalt = null;
  activeVault = null;
}

export function isVaultUnlocked() {
  return Boolean(activeKey && activeSalt && activeVault);
}
