import fs from "fs/promises";
import crypto from "crypto";
import process from "process";

const parseArg = (prefix) => {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
};

const productId = parseArg("--productId");
const bundleId = parseArg("--bundleId");
const appId = parseArg("--appId");
const inAppPurchaseId = parseArg("--inAppPurchaseId");

if (!inAppPurchaseId && !productId) {
  console.error(
    "Usage:\n" +
      "  node scripts/check-iap.mjs --inAppPurchaseId=<resource_id>\n" +
      "  node scripts/check-iap.mjs --productId=<your.product.id> --bundleId=<com.your.app>\n" +
      "  node scripts/check-iap.mjs --productId=<your.product.id> --appId=<app_resource_id>"
  );
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
const nowSec = Math.floor(Date.now() / 1000);
const payload = {
  iss: issuerId,
  iat: nowSec,
  exp: nowSec + 1200,
  aud: "appstoreconnect-v1",
};
const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

if (process.env.DEBUG_APPSTORE_JWT === "1") {
  console.error("JWT header:", header);
  console.error("JWT payload:", payload);
}

const signer = crypto.createSign("SHA256");
signer.update(unsignedToken, "utf8");
signer.end();
const signature = signer.sign({ key: keyData, format: "pem", type: "pkcs8", dsaEncoding: "ieee-p1363" });
const jwt = `${unsignedToken}.${base64url(signature)}`;

const request = async (url) => {
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-apple-request-uuid");
  const parsed = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    const firstError = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    const error = {
      status: response.status,
      requestId,
      id: firstError?.id,
      code: firstError?.code,
      title: firstError?.title,
      detail: firstError?.detail,
      body: parsed ? undefined : text,
    };
    const e = new Error("App Store Connect request failed");
    e.data = error;
    throw e;
  }

  return parsed;
};

const findAppId = async () => {
  if (appId) return appId;
  if (!bundleId) return null;
  const url = new URL("https://api.appstoreconnect.apple.com/v1/apps");
  url.searchParams.set("filter[bundleId]", bundleId);
  url.searchParams.set("fields[apps]", "bundleId,name");
  const data = await request(url);
  const id = Array.isArray(data?.data) && data.data[0]?.id ? String(data.data[0].id) : null;
  return id;
};

const getByInAppPurchaseId = async () => {
  const url = new URL(`https://api.appstoreconnect.apple.com/v1/inAppPurchases/${inAppPurchaseId}`);
  url.searchParams.set("fields[inAppPurchases]", "productId,name,prices");
  return request(url);
};

const getByProductIdFromApp = async () => {
  const resolvedAppId = await findAppId();
  if (!resolvedAppId) {
    console.error("Missing app identifier: pass --bundleId=<com.your.app> or --appId=<app_resource_id>.");
    process.exit(1);
  }

  const tryUrls = [
    // Newer API
    (() => {
      const url = new URL(`https://api.appstoreconnect.apple.com/v1/apps/${resolvedAppId}/inAppPurchasesV2`);
      url.searchParams.set("filter[productId]", productId);
      url.searchParams.set("fields[inAppPurchasesV2]", "productId,name,prices");
      return url;
    })(),
    // Older API
    (() => {
      const url = new URL(`https://api.appstoreconnect.apple.com/v1/apps/${resolvedAppId}/inAppPurchases`);
      url.searchParams.set("filter[productId]", productId);
      url.searchParams.set("fields[inAppPurchases]", "productId,name,prices");
      return url;
    })(),
  ];

  let lastErr = null;
  for (const url of tryUrls) {
    try {
      return await request(url);
    } catch (e) {
      lastErr = e;
      const status = e?.data?.status;
      if (status && status >= 400 && status < 500) continue;
      throw e;
    }
  }
  throw lastErr;
};

try {
  const data = inAppPurchaseId ? await getByInAppPurchaseId() : await getByProductIdFromApp();
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e?.data) {
    console.error("App Store Connect error:", e.data);
  } else {
    console.error("App Store Connect error:", String(e?.message || e));
  }
  process.exit(1);
}
