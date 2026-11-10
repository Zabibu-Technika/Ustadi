import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateLicenseKeyPair, signLicense, writeLicenseFiles } from "../core/license.ts";
import type { LicensePayload } from "../core/types.ts";

const dataDir = resolve(process.env.USTADI_DATA ?? "data");
mkdirSync(dataDir, { recursive: true });

const privatePath = resolve(dataDir, "license-private.pem");
const publicPath = resolve(dataDir, "license-public.pem");
let privateKey: string;
let publicKey: string;

if (existsSync(privatePath) && existsSync(publicPath)) {
  privateKey = readFileSync(privatePath, "utf8");
  publicKey = readFileSync(publicPath, "utf8");
  console.log("Using existing development licence keypair.");
} else {
  const pair = generateLicenseKeyPair();
  privateKey = pair.privateKeyPem;
  publicKey = pair.publicKeyPem;
  writeFileSync(privatePath, privateKey, "utf8");
  writeFileSync(publicPath, publicKey, "utf8");
  console.log("Generated a development Ed25519 licence keypair.");
}

const shopArg = process.argv.find((arg) => arg.startsWith("--shop="));
const shop = shopArg ? shopArg.slice("--shop=".length) : "Ustadi Demo Shop";
const now = new Date();
const expires = new Date(now);
expires.setFullYear(expires.getFullYear() + 1);

const payload: LicensePayload = {
  licenseId: `lic-${now.getTime().toString(36)}`,
  shop,
  deviceLimit: 3,
  issuedAt: now.toISOString(),
  expiresAt: expires.toISOString(),
  features: ["counter", "pocket", "nearby-sync", "offline-reports"]
};

const license = signLicense(payload, privateKey);
writeLicenseFiles(dataDir, license, publicKey);

console.log(`Licence written to ${resolve(dataDir, "license.json")}`);
console.log(`Shop: ${payload.shop}`);
console.log(`Expires: ${payload.expiresAt.slice(0, 10)}`);
console.log("Keep license-private.pem offline. It is gitignored and only the public key ships.");
