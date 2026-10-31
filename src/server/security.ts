import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, value: string) {
  const [salt, digest] = value.split(":");
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function redact(text: string) {
  return text
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/g, "[已脱敏密钥]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[\w.\-]+/gi, "$1[已脱敏]")
    .replace(
      /((?:api[_-]?key|password|secret|token)\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      "$1[已脱敏]",
    )
    .replace(
      /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}(?![A-Z0-9.-])/gi,
      "[已脱敏邮箱]",
    );
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
