const DB_NAME = "control-prestamos-local";
const DB_VERSION = 1;
const VAULT_STORE = "vault";
const VAULT_ID = "primary";
const PBKDF2_ITERATIONS = 250000;
const BIOMETRIC_INFO = new TextEncoder().encode("Control Prestamos operator vault key wrapping v1");

let activeDataKey = null;
let activeDataKeyRaw = null;
let activeVault = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
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
    if (!("indexedDB" in globalThis)) { reject(new Error("Este navegador no permite el almacenamiento local necesario.")); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(VAULT_STORE)) request.result.createObjectStore(VAULT_STORE, { keyPath: "id" }); };
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
  } finally { db.close(); }
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
  } finally { db.close(); }
}
async function derivePinKey(pin, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function deriveBiometricWrappingKey(prfOutput, salt) {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: BIOMETRIC_INFO }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bytesToBase64(iv), wrappedKey: bytesToBase64(new Uint8Array(ciphertext)) };
}
async function decryptBytes(key, iv, ciphertext) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext)));
}
async function importDataKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptVaultPayload(key, vault) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(vault));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}
async function decryptVaultPayload(key, record) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv) }, key, base64ToBytes(record.ciphertext));
  return normalizeVault(JSON.parse(new TextDecoder().decode(plaintext)));
}
function normalizeVault(value) {
  return {
    version: 1, ownerId: value.ownerId || null, userId: value.userId || null,
    customers: Array.isArray(value.customers) ? value.customers : [],
    loans: Array.isArray(value.loans) ? value.loans : [],
    queue: Array.isArray(value.queue) ? value.queue : [],
    lastSyncAt: value.lastSyncAt || null,
    updatedAt: new Date().toISOString()
  };
}
async function createVersion2Record(pin, vault) {
  const pinSalt = crypto.getRandomValues(new Uint8Array(16));
  const dataKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const pinKey = await derivePinKey(pin, pinSalt);
  const wrapped = await encryptBytes(pinKey, dataKeyRaw);
  const dataKey = await importDataKey(dataKeyRaw);
  const payload = await encryptVaultPayload(dataKey, vault);
  return {
    record: { id: VAULT_ID, version: 2, pin: { salt: bytesToBase64(pinSalt), iv: wrapped.iv, wrappedKey: wrapped.wrappedKey }, ...payload, updatedAt: new Date().toISOString() },
    dataKeyRaw, dataKey
  };
}
function activateKey(raw, key, vault) {
  if (activeDataKeyRaw) activeDataKeyRaw.fill(0);
  activeDataKeyRaw = raw.slice();
  activeDataKey = key;
  activeVault = vault;
}
export async function hasVault() { return Boolean(await readVaultRecord()); }
export async function getBiometricInfo() {
  const record = await readVaultRecord();
  if (record?.version !== 2 || !record.biometric?.credentialId || !record.biometric?.prfSalt || !record.biometric?.rpId) return null;
  return { credentialId: record.biometric.credentialId, prfSalt: record.biometric.prfSalt, rpId: record.biometric.rpId };
}
export async function createVault(pin, initialData) {
  if (!/^\d{4,6}$/.test(String(pin))) throw new Error("El PIN debe tener entre 4 y 6 números.");
  if (await hasVault()) throw new Error("Ya existe una copia local. No se sobrescribió para proteger los registros pendientes.");
  const vault = normalizeVault(initialData || {});
  if (!vault.ownerId || !vault.userId) throw new Error("La copia local necesita la vinculación del dispositivo.");
  const result = await createVersion2Record(pin, vault);
  await writeVaultRecord(result.record);
  activateKey(result.dataKeyRaw, result.dataKey, vault);
  return clone(activeVault);
}
export async function unlockVault(pin) {
  const record = await readVaultRecord();
  if (!record) throw new Error("Este celular no tiene una copia offline configurada. Conéctate a Internet y desbloquea una vez.");
  try {
    let vault, keyRaw, key;
    if (record.version === 1) {
      const legacySalt = base64ToBytes(record.salt);
      const legacyKey = await derivePinKey(pin, legacySalt);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv) }, legacyKey, base64ToBytes(record.ciphertext));
      vault = normalizeVault(JSON.parse(new TextDecoder().decode(plaintext)));
      const migrated = await createVersion2Record(pin, vault);
      await writeVaultRecord(migrated.record);
      keyRaw = migrated.dataKeyRaw; key = migrated.dataKey;
    } else if (record.version === 2 && record.pin?.salt && record.pin?.wrappedKey && record.pin?.iv) {
      const pinKey = await derivePinKey(pin, base64ToBytes(record.pin.salt));
      keyRaw = await decryptBytes(pinKey, record.pin.iv, record.pin.wrappedKey);
      key = await importDataKey(keyRaw);
      vault = await decryptVaultPayload(key, record);
    } else throw new Error("Formato de copia local desconocido.");
    if (!vault.ownerId || !vault.userId) throw new Error("La copia local no tiene el vínculo completo del dispositivo.");
    activateKey(keyRaw, key, vault);
    return clone(activeVault);
  } catch (error) {
    activeDataKey = null; if (activeDataKeyRaw) activeDataKeyRaw.fill(0); activeDataKeyRaw = null; activeVault = null;
    if (error instanceof Error && (error.message.includes("vínculo completo") || error.message.includes("Formato de copia"))) throw error;
    throw new Error("El PIN no coincide con la copia local o los datos locales están dañados.");
  }
}
export async function enableBiometricUnlock({ credentialId, rpId, prfSalt, prfOutput }) {
  if (!activeDataKey || !activeDataKeyRaw || !activeVault) throw new Error("Desbloquea primero la aplicación con tu PIN.");
  if (!credentialId || !rpId || !(prfSalt instanceof Uint8Array) || !(prfOutput instanceof Uint8Array) || prfOutput.length < 32) throw new Error("La credencial biométrica no devolvió una clave válida.");
  const record = await readVaultRecord();
  if (record?.version !== 2 || !record.pin) throw new Error("No se pudo preparar el cifrado biométrico.");
  const wrappingKey = await deriveBiometricWrappingKey(prfOutput, prfSalt);
  const wrapped = await encryptBytes(wrappingKey, activeDataKeyRaw);
  record.biometric = { credentialId, rpId, prfSalt: bytesToBase64(prfSalt), iv: wrapped.iv, wrappedKey: wrapped.wrappedKey };
  record.updatedAt = new Date().toISOString();
  await writeVaultRecord(record);
  return true;
}
export async function unlockVaultWithBiometric(prfOutput) {
  const record = await readVaultRecord();
  if (record?.version !== 2 || !record.biometric) throw new Error("Este dispositivo no tiene la huella configurada.");
  try {
    const salt = base64ToBytes(record.biometric.prfSalt);
    const wrappingKey = await deriveBiometricWrappingKey(prfOutput, salt);
    const keyRaw = await decryptBytes(wrappingKey, record.biometric.iv, record.biometric.wrappedKey);
    const key = await importDataKey(keyRaw);
    const vault = await decryptVaultPayload(key, record);
    if (!vault.ownerId || !vault.userId) throw new Error("La copia local no tiene el vínculo completo del dispositivo.");
    activateKey(keyRaw, key, vault);
    return clone(activeVault);
  } catch (error) {
    activeDataKey = null; if (activeDataKeyRaw) activeDataKeyRaw.fill(0); activeDataKeyRaw = null; activeVault = null;
    if (error instanceof Error && error.message.includes("vínculo completo")) throw error;
    throw new Error("La huella no coincidió con la credencial del almacenamiento local o la copia está dañada.");
  }
}
export async function disableBiometricUnlock() {
  const record = await readVaultRecord();
  if (!record?.biometric) return false;
  delete record.biometric;
  record.updatedAt = new Date().toISOString();
  await writeVaultRecord(record);
  return true;
}
export async function saveVault(nextValue) {
  if (!activeDataKey || !activeDataKeyRaw || !activeVault) throw new Error("La copia local está bloqueada; desbloquea Control Préstamos antes de guardar.");
  const nextVault = normalizeVault(nextValue);
  const record = await readVaultRecord();
  if (record?.version !== 2) throw new Error("No se pudo actualizar la copia cifrada.");
  const payload = await encryptVaultPayload(activeDataKey, nextVault);
  const nextRecord = { ...record, ...payload, updatedAt: new Date().toISOString() };
  await writeVaultRecord(nextRecord);
  activeVault = nextVault;
  return clone(activeVault);
}
export function getVault() {
  if (!activeVault) throw new Error("La copia local está bloqueada.");
  return clone(activeVault);
}
export function lockVault() {
  if (activeDataKeyRaw) activeDataKeyRaw.fill(0);
  activeDataKey = null; activeDataKeyRaw = null; activeVault = null;
}
export function isVaultUnlocked() { return Boolean(activeDataKey && activeDataKeyRaw && activeVault); }
