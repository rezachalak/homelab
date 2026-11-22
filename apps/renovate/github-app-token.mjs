// Mints a short-lived GitHub App installation token for Renovate and prints it on
// stdout. Self-hosted Renovate only accepts a token, not App credentials, and
// installation tokens expire after 1 hour - so one is minted at the start of every run.
//
// Inputs (env):  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE, GITHUB_REPOSITORY (owner/name)
// The token is scoped to that single repository. Uses only Node built-ins (no deps).
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const appId = process.env.GITHUB_APP_ID;
const keyFile = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
const repository = process.env.GITHUB_REPOSITORY;
if (!appId || !keyFile || !repository) {
  throw new Error("GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE and GITHUB_REPOSITORY must be set");
}
const [owner, repo] = repository.split("/");

// App JWT (RS256), valid for 9 minutes; iat backdated 60s for clock skew.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ iat: now - 60, exp: now + 540, iss: appId })}`;
const signature = createSign("RSA-SHA256").update(unsigned).sign(readFileSync(keyFile, "utf8"), "base64url");
const jwt = `${unsigned}.${signature}`;

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${jwt}`,
  "User-Agent": "renovate-github-app-token",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${data.message ?? "no message"}`);
  return data;
}

try {
  const installation = await github("GET", `/repos/${owner}/${repo}/installation`);
  const { token } = await github("POST", `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repo],
  });
  process.stdout.write(token);
} catch (err) {
  console.error(`github-app-token: ${err.message}`);
  process.exit(1);
}
