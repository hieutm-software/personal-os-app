const SHARED_TEXT_ENCODER = new TextEncoder();
const SHARED_TEXT_DECODER = new TextDecoder();

export class VaultCrypto {
  private static readonly ALGORITHM = "AES-GCM";
  private static readonly KEY_LENGTH = 256;
  private static readonly PBKDF2_ITERATIONS = 600000;
  private static readonly SALT_LENGTH = 16;
  private static readonly IV_LENGTH = 12;
  private static readonly GCM_TAG_LENGTH = 16;
  private static readonly MIN_PAYLOAD_BYTES =
    VaultCrypto.SALT_LENGTH + VaultCrypto.IV_LENGTH + VaultCrypto.GCM_TAG_LENGTH;
  private static readonly BASE64_CHUNK_SIZE = 8192;

  private static bufferToBase64(buffer: Uint8Array): string {
    try {
      const length = buffer.length;
      if (length === 0) return "";
      const chunks: string[] = [];
      for (let i = 0; i < length; i += this.BASE64_CHUNK_SIZE) {
        const slice = buffer.subarray(i, Math.min(i + this.BASE64_CHUNK_SIZE, length));
        chunks.push(String.fromCharCode(...slice));
      }
      return btoa(chunks.join(""));
    } catch {
      return "";
    }
  }

  private static base64ToBuffer(base64: string): Uint8Array {
    try {
      if (typeof base64 !== "string" || !base64.trim()) {
        return new Uint8Array(0);
      }
      const binary = atob(base64.trim());
      const len = binary.length;
      const buffer = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buffer[i] = binary.charCodeAt(i);
      }
      return buffer;
    } catch {
      return new Uint8Array(0);
    }
  }

  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const passwordBuffer = SHARED_TEXT_ENCODER.encode(password);
    try {
      const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        passwordBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );

      return await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: salt as BufferSource,
          iterations: this.PBKDF2_ITERATIONS,
          hash: "SHA-256",
        },
        keyMaterial,
        { name: this.ALGORITHM, length: this.KEY_LENGTH },
        false,
        ["encrypt", "decrypt"]
      );
    } catch {
      throw new Error("Key derivation failed");
    } finally {
      passwordBuffer.fill(0);
    }
  }

  public static async encrypt(data: string, password: string): Promise<string> {
    if (typeof password !== "string" || !password) {
      throw new Error("Master password is required for encryption");
    }
    if (typeof data !== "string") {
      throw new Error("Plaintext data must be a string");
    }

    const salt = window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const dataBuffer = SHARED_TEXT_ENCODER.encode(data);
    let encryptedView: Uint8Array | null = null;
    let payload: Uint8Array | null = null;

    try {
      const key = await this.deriveKey(password, salt);
      const encryptedContent = await window.crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: iv as BufferSource,
        },
        key,
        dataBuffer
      );

      encryptedView = new Uint8Array(encryptedContent);
      payload = new Uint8Array(this.SALT_LENGTH + this.IV_LENGTH + encryptedView.length);
      payload.set(salt, 0);
      payload.set(iv, this.SALT_LENGTH);
      payload.set(encryptedView, this.SALT_LENGTH + this.IV_LENGTH);

      const encoded = this.bufferToBase64(payload);
      if (!encoded) {
        throw new Error("Encoding failed");
      }
      return encoded;
    } catch {
      throw new Error("Encryption failed");
    } finally {
      dataBuffer.fill(0);
      salt.fill(0);
      iv.fill(0);
      if (encryptedView) encryptedView.fill(0);
      if (payload) payload.fill(0);
    }
  }

  public static async decrypt(encryptedBase64: string, password: string): Promise<string> {
    if (typeof password !== "string" || !password) {
      throw new Error("Master password is required for decryption");
    }
    if (typeof encryptedBase64 !== "string" || !encryptedBase64) {
      throw new Error("Invalid vault payload: empty input");
    }

    const payload = this.base64ToBuffer(encryptedBase64);
    if (payload.length < this.MIN_PAYLOAD_BYTES) {
      payload.fill(0);
      throw new Error("Invalid vault payload: insufficient length.");
    }

    const salt = payload.subarray(0, this.SALT_LENGTH);
    const iv = payload.subarray(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
    const ciphertext = payload.subarray(this.SALT_LENGTH + this.IV_LENGTH);
    let decryptedView: Uint8Array | null = null;

    try {
      const key = await this.deriveKey(password, salt);
      const decryptedContent = await window.crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv as BufferSource,
        },
        key,
        ciphertext as BufferSource
      );

      decryptedView = new Uint8Array(decryptedContent);
      return SHARED_TEXT_DECODER.decode(decryptedView);
    } catch {
      throw new Error("Decryption failed. Incorrect master password or corrupted data.");
    } finally {
      if (decryptedView) decryptedView.fill(0);
      payload.fill(0);
    }
  }
}
