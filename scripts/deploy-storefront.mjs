#!/usr/bin/env node
// Deploys a scaffolded per-business storefront repo to Vercel and registers
// {slug}.storefronts.rough.ink as its production domain, replacing the
// {project}.vercel.app fallback as the default (THI-57).
//
// Usage:
//   node scripts/deploy-storefront.mjs --slug acme-test [--dir <path>]
//
// Requires the Vercel CLI to already be authenticated (`vercel whoami`) with
// access to the team that owns rough.ink. That domain's nameservers are
// delegated to Vercel (ns1/ns2.vercel-dns.com), so `vercel domains add`
// below provisions both the DNS record and the TLS cert for the new
// subdomain automatically — no separate manual DNS step is needed. See
// DECISIONS.md §deploy (THI-57) for how this was verified live.
//
// What it does, in order:
//   1. `vercel link` the storefront repo to a project named
//      `{slug}-storefront` (links the existing project on redeploys;
//      creates it on first deploy).
//   2. `vercel deploy --prod` to build and publish.
//   3. `vercel domains add {slug}.storefronts.rough.ink {slug}-storefront`
//      — idempotent; already-registered is not treated as an error.
//   4. Live HTTP verification: polls the domain and requires a real `200`,
//      per the THI-41 rule in DECISIONS.md that a Vercel `READY` build
//      state is necessary but not sufficient proof of a working deploy.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const VERCEL_SCOPE = process.env.STOREFRONT_VERCEL_SCOPE ?? "dean-roughs-projects";
const DOMAIN_BASE = process.env.STOREFRONT_DOMAIN_BASE ?? "storefronts.rough.ink";
const VERIFY_TIMEOUT_MS = 60_000;
const VERIFY_POLL_MS = 3_000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--slug") args.slug = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.slug) throw new Error("--slug is required");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(args.slug)) {
    throw new Error(`--slug "${args.slug}" must be lowercase alphanumeric with internal hyphens only`);
  }
  args.dir = args.dir ?? path.join(REPO_ROOT, "..", "thismade-storefronts", args.slug);
  return args;
}

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function runCapture(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function addDomain(dir, domain, projectName) {
  try {
    run("vercel", ["domains", "add", domain, projectName, "--scope", VERCEL_SCOPE], dir);
  } catch (err) {
    const message = String(err.stderr ?? err.stdout ?? err.message ?? "");
    if (!/already exists|already in use|already assigned|already added/i.test(message)) throw err;
    console.log(`Domain ${domain} is already registered to ${projectName}; continuing.`);
  }
}

function verifyLive(url) {
  console.log(`\nVerifying live deploy at ${url} ...`);
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let status = null;
  while (Date.now() < deadline) {
    try {
      status = runCapture("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", url], REPO_ROOT);
    } catch {
      status = null;
    }
    if (status === "200") {
      console.log(`Verified: ${url} -> HTTP 200`);
      return;
    }
    execFileSync("sleep", [String(VERIFY_POLL_MS / 1000)]);
  }
  throw new Error(
    `Live verification failed: GET ${url} returned "${status ?? "no response"}", expected 200. ` +
      `A green Vercel build state is not sufficient proof of a working deploy — see DECISIONS.md §deploy (THI-41).`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectName = `${args.slug}-storefront`;
  const domain = `${args.slug}.${DOMAIN_BASE}`;

  run("vercel", ["link", "--yes", "--project", projectName, "--scope", VERCEL_SCOPE], args.dir);
  run("vercel", ["deploy", "--prod", "--yes", "--scope", VERCEL_SCOPE], args.dir);
  addDomain(args.dir, domain, projectName);
  verifyLive(`https://${domain}/`);

  console.log(`\nDone. ${args.slug} is live at https://${domain}/`);
}

main();
