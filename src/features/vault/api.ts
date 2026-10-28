import { invoke } from "@tauri-apps/api/core";

const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;
const MAX_REASON_LENGTH = 200;

export async function authenticateOS(reason: string): Promise<boolean> {
  try {
    const cleanReason =
      typeof reason === "string"
        ? reason.replace(CONTROL_CHARS_REGEX, "").trim().slice(0, MAX_REASON_LENGTH)
        : "";
    const result = await invoke<boolean>("authenticate_os", {
      reason: cleanReason || "Unlock Vault",
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

export async function getVaultKey(): Promise<string> {
  try {
    const key = await invoke<string>("get_vault_key");
    return typeof key === "string" ? key : "";
  } catch {
    return "";
  }
}
