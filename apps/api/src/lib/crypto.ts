import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";

const key = createHash("sha256").update(config.secretKey).digest();

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token. 32 bytes = 256 bits. */
export function randomToken(bytes = 32, prefix = "") {
  return prefix + randomBytes(bytes).toString("base64url");
}

export function shortId(bytes = 2) {
  return randomBytes(bytes).toString("hex");
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string) {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8");
}

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });
export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);
