import fs from "fs/promises";
import crypto from "crypto";
import process from "process";

const parseArg = (prefix) => {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
};

const productId = parseArg("--productId");
if (!productId) {
  console.error("Usage: node scripts/check-iap.mjs --productId=your.product.id");
  process.exit(1);
}

const keyPath = process.env.APP_STORE_KEY_PATH || process.env.APPSTORE_PRIVATE_KEY_PATH;
const keyId = process.env.APP_STORE_KEY_ID || process.env.APPSTORE_KEY_ID;
const issuerId = process.env.APP_STORE_ISSUER_ID || process.env.APPSTORE_ISSUER_ID;

if (!keyPath || !keyId || !issuerId) {
  console.error("Set APP_STORE_KEY_PATH, APP_STORE_KEY_ID and APP_STORE_ISSUER_ID");
  process.exit(1);
}

const keyData = await fs.readFile(keyPath, "utf8");

const base64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const header = { alg: "ES256", kid: keyId };
const payload = {
  iss: issuerId,
  exp: Math.floor(Date.now() / 1000) + 1200,
  aud: "appstoreconnect-v1",
};
const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

const signer = crypto.createSign("SHA256");
signer.update(unsignedToken);
signer.end();
const signature = signer.sign({ key: keyData, format: "pem", type: "pkcs8", dsaEncoding: "ieee-p1363" });
const jwt = `${unsignedToken}.${base64url(signature)}`;

const url = new URL("https://api.appstoreconnect.apple.com/v1/inAppPurchases");
url.searchParams.set("filter[productId]", productId);
url.searchParams.set("fields[inAppPurchases]", "productId,name,prices");

const response = await fetch(url.toString(), {
  headers: {
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  },
});

if (!response.ok) {
  console.error("App Store Connect error:", response.status, await response.text());
  process.exit(1);
}

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
