#!/usr/bin/env node
// Scaffolds a fresh per-business storefront repo from storefront-template/.
//
// Usage:
//   node scripts/scaffold-storefront.mjs --slug acme-test --name "Acme Test Co" [--out <dir>] [--force]
//
// What it does, in order:
//   1. Copies storefront-template/ into a new sibling repo (default:
//      ../thismade-storefronts/<slug>, next to this platform checkout).
//   2. Substitutes __BUSINESS_NAME__ / __BUSINESS_SLUG__ placeholders.
//   3. Generates fresh, per-business ADMIN_JWT_SECRET, FULFILLMENT_HMAC_SECRET,
//      and CONVEX_SERVICE_SECRET values into a gitignored .env.local.
//   4. Runs `npm install` and Convex codegen with the ambient
//      CONVEX_DEPLOY_KEY/CONVEX_DEPLOYMENT/NEXT_PUBLIC_CONVEX_URL stripped
//      from the child process env — those vars, if inherited, would point
//      at the *platform's own* shared Convex deployment, not a deployment
//      for this business. See storefront-template/README.md.
//   5. Sets CONVEX_SERVICE_SECRET as an environment variable *on* the
//      freshly provisioned Convex deployment itself (`convex env set`) — the
//      value in .env.local is what the Next.js server presents; the
//      deployment needs its own copy to check incoming calls against (THI-53,
//      convex/lib/serviceAuth.ts). Without this step every fulfillmentEvents
//      action would reject with service_secret_not_configured.
//   6. Runs the build/typecheck/test gate (`npm run gate`, defined in
//      storefront-template/package.json). Every future coding-agent edit to
//      a generated storefront must pass this same gate before it commits —
//      this script's step 7 is the reference implementation of that rule.
//   7. Only on a fully green gate: `git init` + one commit. A failing gate
//      aborts with a non-zero exit and no commit is made.
//   7. Deploys to Vercel and registers {slug}.storefronts.rough.ink as the
//      production domain (scripts/deploy-storefront.mjs). Pass --skip-deploy
//      to scaffold without deploying, e.g. in an environment with no Vercel
//      CLI session.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const TEMPLATE_DIR = path.join(REPO_ROOT, "storefront-template");

const EXCLUDED_ENTRIES = new Set([
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  "next-env.d.ts",
]);
const EXCLUDED_SUFFIXES = [".tsbuildinfo"];

// convex/_generated is regenerated fresh per business rather than copied,
// since it's derived output.
const EXCLUDED_RELATIVE_PATHS = new Set(["convex/_generated"]);

function parseArgs(argv) {
  const args = { force: false, skipDeploy: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--slug") args.slug = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--force") args.force = true;
    else if (arg === "--skip-deploy") args.skipDeploy = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.slug) throw new Error("--slug is required");
  if (!args.name) throw new Error("--name is required");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(args.slug)) {
    throw new Error(
      `--slug "${args.slug}" must be lowercase alphanumeric with internal hyphens only (it becomes a directory name, a JWT subject, and eventually a subdomain label)`,
    );
  }
  return args;
}

function copyTemplate(srcDir, destDir, relativePath = "") {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (EXCLUDED_ENTRIES.has(entry)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    const entryRelative = relativePath ? `${relativePath}/${entry}` : entry;
    if (EXCLUDED_RELATIVE_PATHS.has(entryRelative)) continue;

    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyTemplate(srcPath, destPath, entryRelative);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

function substituteTokensInPlace(dir, tokens) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      substituteTokensInPlace(fullPath, tokens);
      continue;
    }
    // Skip binary-ish/lockfile content we don't need to touch.
    if (entry.name === "package-lock.json") continue;
    const original = readFileSync(fullPath, "utf8");
    let updated = original;
    for (const [token, value] of Object.entries(tokens)) {
      updated = updated.split(token).join(value);
    }
    if (updated !== original) writeFileSync(fullPath, updated);
  }
}

export function run(command, args, cwd, env, { redactArgAt } = {}) {
  const shown =
    redactArgAt == null
      ? args
      : args.map((arg, i) => (i === redactArgAt ? "<redacted>" : arg));
  console.log(`\n$ ${command} ${shown.join(" ")}  (cwd: ${cwd})`);
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

/**
 * Strips platform Convex credentials from the child env. Without this, a
 * `convex` invocation in the generated repo would silently inherit
 * CONVEX_DEPLOY_KEY/CONVEX_DEPLOYMENT scoped to the *platform's* shared dev
 * deployment and could push this storefront's schema/functions there
 * instead of to a deployment of its own.
 */
function sanitizedEnv() {
  const env = { ...process.env };
  delete env.CONVEX_DEPLOY_KEY;
  delete env.CONVEX_DEPLOYMENT;
  delete env.NEXT_PUBLIC_CONVEX_URL;
  delete env.NEXT_PUBLIC_CONVEX_SITE_URL;
  return env;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir =
    args.out ?? path.join(REPO_ROOT, "..", "thismade-storefronts", args.slug);

  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !args.force) {
    throw new Error(`${outDir} already exists and is non-empty. Pass --force to overwrite into it.`);
  }

  console.log(`Scaffolding storefront "${args.name}" (${args.slug}) -> ${outDir}`);
  copyTemplate(TEMPLATE_DIR, outDir);
  substituteTokensInPlace(outDir, {
    __BUSINESS_NAME__: args.name,
    __BUSINESS_SLUG__: args.slug,
  });

  const adminSecret = randomBytes(32).toString("hex");
  const fulfillmentSecret = randomBytes(32).toString("hex");
  const convexServiceSecret = randomBytes(32).toString("hex");
  writeFileSync(
    path.join(outDir, ".env.local"),
    [
      `BUSINESS_SLUG=${args.slug}`,
      `ADMIN_JWT_SECRET=${adminSecret}`,
      `FULFILLMENT_HMAC_SECRET=${fulfillmentSecret}`,
      `CONVEX_SERVICE_SECRET=${convexServiceSecret}`,
      "# CONVEX_DEPLOYMENT / NEXT_PUBLIC_CONVEX_URL are appended below by the",
      "# local anonymous Convex backend this script provisions next (dev/test",
      "# only — it's not reachable once deployed; see README.md 'Known gap').",
      "",
    ].join("\n"),
  );

  const env = sanitizedEnv();
  run("npm", ["install"], outDir, env);
  // CONVEX_AGENT_MODE=anonymous provisions a fully local Convex backend
  // (http://127.0.0.1:xxxx, no cloud account) non-interactively — see
  // README.md "Known gap: per-business Convex provisioning" for why this
  // isn't a real per-business cloud deployment yet.
  run(
    "npx",
    ["convex", "dev", "--once", "--typecheck", "disable"],
    outDir,
    { ...env, CONVEX_AGENT_MODE: "anonymous" },
  );
  // THI-53: give the deployment itself a copy of the secret its actions
  // check (convex/lib/serviceAuth.ts) — the .env.local copy above is only
  // what the Next.js server presents when calling in.
  run(
    "npx",
    ["convex", "env", "set", "CONVEX_SERVICE_SECRET", convexServiceSecret],
    outDir,
    { ...env, CONVEX_AGENT_MODE: "anonymous" },
    { redactArgAt: 4 },
  );
  run("npm", ["run", "gate"], outDir, env);

  run("git", ["init", "-q"], outDir, env);
  run("git", ["add", "-A"], outDir, env);
  run(
    "git",
    [
      "commit",
      "-q",
      "-m",
      `Scaffold storefront: ${args.slug}\n\nGenerated by scripts/scaffold-storefront.mjs from storefront-template/.\nbuild + typecheck + test all green before this commit.\n\nCo-Authored-By: Paperclip <noreply@paperclip.ing>`,
    ],
    outDir,
    env,
  );

  console.log(`\nDone. Storefront repo ready at: ${outDir}`);
  console.log(`Admin, fulfillment, and Convex service secrets were generated fresh and written to ${outDir}/.env.local (gitignored).`);

  if (args.skipDeploy) {
    console.log(`\n--skip-deploy passed; not deploying. Run scripts/deploy-storefront.mjs --slug ${args.slug} later to publish.`);
    return;
  }

  run(
    "node",
    [path.join(SCRIPT_DIR, "deploy-storefront.mjs"), "--slug", args.slug, "--dir", outDir],
    REPO_ROOT,
    env,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
