import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import type { LicensePayload, LicenseStatus, SignedLicense } from "./types.ts";
import { canonicalJson } from "./canonical.ts";

export interface LicenseKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateLicenseKeyPair(): LicenseKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): SignedLicense {
  const signature = sign(null, Buffer.from(canonicalJson(payload), "utf8"), privateKeyPem).toString("base64");
  return { payload, signature };
}

export function verifyLicense(license: SignedLicense, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(license.payload), "utf8"),
      publicKeyPem,
      Buffer.from(license.signature, "base64")
    );
  } catch {
    return false;
  }
}

export function licenseStatus(dataDir: string, now = new Date()): LicenseStatus {
  const licensePath = join(dataDir, "license.json");
  const publicKeyPath = join(dataDir, "license-public.pem");
  if (!existsSync(licensePath) || !existsSync(publicKeyPath)) {
    return {
      mode: "community",
      message: "Community mode. Offline licence not installed; this build is limited to one shop and 25 products."
    };
  }
  try {
    const license = JSON.parse(readFileSync(licensePath, "utf8")) as SignedLicense;
    const publicKey = readFileSync(publicKeyPath, "utf8");
    if (!verifyLicense(license, publicKey)) {
      return { mode: "invalid", message: "Licence signature is invalid." };
    }
    if (Date.parse(license.payload.expiresAt) < now.getTime()) {
      return {
        mode: "expired",
        shop: license.payload.shop,
        expiresAt: license.payload.expiresAt,
        message: "Licence expired. Renew to keep the shop licensed."
      };
    }
    return {
      mode: "licensed",
      shop: license.payload.shop,
      expiresAt: license.payload.expiresAt,
      deviceLimit: license.payload.deviceLimit,
      features: license.payload.features,
      message: `Licensed to ${license.payload.shop} until ${license.payload.expiresAt.slice(0, 10)}.`
    };
  } catch {
    return { mode: "invalid", message: "Licence file could not be read." };
  }
}

export function writeLicenseFiles(
  dataDir: string,
  license: SignedLicense,
  publicKeyPem: string
): void {
  writeFileSync(join(dataDir, "license.json"), JSON.stringify(license, null, 2) + "\n", "utf8");
  writeFileSync(join(dataDir, "license-public.pem"), publicKeyPem, "utf8");
}
