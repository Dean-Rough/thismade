import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeTool,
  isDestructiveToolCall,
  planNavigationHop,
  stripSpeculativeLinkTags,
  hasBlockedLinkRel,
  neutralizeSpeculativeLinkElement,
  BROWSER_DRIVER_SCRIPT,
} from "./workerTools";
import type { ToolExecutionContext, MinimalLinkElement } from "./workerTools";
import type { SandboxCommandResult, SandboxHandle } from "./sandboxProvider";

// A minimal SandboxHandle whose runCommand records every invocation. If
// navigate() ever reaches the sandbox for a URL that should have been
// blocked, `commands` will be non-empty and the test fails on that instead
// of (or in addition to) the thrown error - this is what makes these tests
// actually prove the sandbox never sees the disallowed navigation, not just
// that *a* rejection happened.
class RecordingSandbox implements SandboxHandle {
  commands: string[] = [];

  async runCommand(command: string): Promise<SandboxCommandResult> {
    this.commands.push(command);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFile(): Promise<void> {}
  async readFile(): Promise<string> {
    throw new Error("not_implemented");
  }
  async close(): Promise<void> {}
}

async function attemptNavigate(url: string, ctx: Partial<ToolExecutionContext> = {}) {
  const sandbox = new RecordingSandbox();
  let error: unknown;
  try {
    await executeTool("browser", "navigate", { url }, { sandbox, ...ctx });
  } catch (err) {
    error = err;
  }
  return { sandbox, error };
}

describe("executeTool navigate URL validation (THI-71)", () => {
  it("rejects a file:// URL before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("file:///etc/passwd");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:disallowed_scheme:file:");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a javascript: URL before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("javascript:alert(document.cookie)");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:disallowed_scheme:javascript:");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a literal loopback IP host before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("http://127.0.0.1/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:127.0.0.1");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects the cloud-metadata link-local address", async () => {
    const { sandbox, error } = await attemptNavigate("http://169.254.169.254/latest/meta-data/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:169.254.169.254");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects an RFC1918 private IP host", async () => {
    const { sandbox, error } = await attemptNavigate("https://10.0.0.5/internal-admin");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:10.0.0.5");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects an IPv6 loopback host", async () => {
    const { sandbox, error } = await attemptNavigate("http://[::1]/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:::1");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a hostname whose DNS resolution lands on a private IP (DNS-rebinding shape)", async () => {
    const { sandbox, error } = await attemptNavigate("https://attacker-controlled.example/", {
      resolveHostnameAddresses: async () => ["10.1.2.3"],
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:attacker-controlled.example");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("fails closed when DNS resolution errors instead of allowing the navigation through", async () => {
    const { sandbox, error } = await attemptNavigate("https://does-not-resolve.example/", {
      resolveHostnameAddresses: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:dns_resolution_failed:does-not-resolve.example");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("allows a normal public https URL whose hostname resolves to a public IP", async () => {
    const { sandbox, error } = await attemptNavigate("https://example.com/", {
      resolveHostnameAddresses: async () => ["93.184.216.34"],
    });
    expect(error).toBeUndefined();
    expect(sandbox.commands.length).toBeGreaterThan(0);
  });
});

describe("isDestructiveToolCall (THI-66)", () => {
  it("flags the coding worker's run_shell as destructive", () => {
    expect(isDestructiveToolCall("coding", "run_shell")).toBe(true);
  });

  it("does not flag coding's other tools — they stay inside the sandbox workspace", () => {
    expect(isDestructiveToolCall("coding", "read_file")).toBe(false);
    expect(isDestructiveToolCall("coding", "write_file")).toBe(false);
    expect(isDestructiveToolCall("coding", "list_directory")).toBe(false);
  });

  it("does not flag any browser or marketing tool — neither workerType has a destructive tool registered yet", () => {
    expect(isDestructiveToolCall("browser", "navigate")).toBe(false);
    expect(isDestructiveToolCall("browser", "click")).toBe(false);
    expect(isDestructiveToolCall("browser", "read_page_text")).toBe(false);
    expect(isDestructiveToolCall("marketing", "read_context_file")).toBe(false);
    expect(isDestructiveToolCall("marketing", "submit_draft")).toBe(false);
  });

  it("does not throw or misclassify an unregistered tool name — callers must check assertToolAllowed separately", () => {
    expect(isDestructiveToolCall("marketing", "run_shell")).toBe(false);
  });
});

// THI-72: planNavigationHop is the tested source of truth for the pinning
// decision the sandboxed browser driver's hand-written mirror (pinHostname
// in BROWSER_DRIVER_SCRIPT) has to reproduce - these tests exercise the
// actual algorithm directly, since the driver script itself only runs
// inside a real E2B sandbox this environment doesn't have credentials for.
describe("planNavigationHop (THI-72 DNS-rebinding pin)", () => {
  it("rejects a disallowed scheme before ever resolving anything", async () => {
    const resolveHostname = vi.fn();
    await expect(planNavigationHop("file:///etc/passwd", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:disallowed_scheme:file:",
    );
    expect(resolveHostname).not.toHaveBeenCalled();
  });

  it("rejects a blocked literal IP with no rule to pin", async () => {
    await expect(planNavigationHop("http://169.254.169.254/", new Set(), vi.fn())).rejects.toThrow(
      "navigate_blocked:private_address:169.254.169.254",
    );
  });

  it("returns no rule for an allowed literal IP - nothing to pin, Chromium connects directly", async () => {
    const plan = await planNavigationHop("http://93.184.216.34/", new Set(), vi.fn());
    expect(plan).toEqual({ hostname: "93.184.216.34", newHostResolverRule: null });
  });

  it("resolves an unpinned hostname and returns a MAP rule joining every validated address", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["93.184.216.34", "93.184.216.35"]);
    const plan = await planNavigationHop("https://example.com/", new Set(), resolveHostname);
    expect(resolveHostname).toHaveBeenCalledWith("example.com");
    expect(plan).toEqual({
      hostname: "example.com",
      newHostResolverRule: "MAP example.com 93.184.216.34,93.184.216.35",
    });
  });

  it("rejects a hostname if any resolved address is private, even if others are public", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["93.184.216.34", "10.0.0.5"]);
    await expect(planNavigationHop("https://mixed.example/", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:private_address:mixed.example",
    );
  });

  it("does not re-resolve an already-pinned hostname (this is what closes the rebinding window on repeat hops)", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["10.0.0.5"]); // would fail if it were called
    const plan = await planNavigationHop("https://already-pinned.example/", new Set(["already-pinned.example"]), resolveHostname);
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(plan).toEqual({ hostname: "already-pinned.example", newHostResolverRule: null });
  });

  it("fails closed when DNS resolution throws", async () => {
    const resolveHostname = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(planNavigationHop("https://does-not-resolve.example/", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:dns_resolution_failed:does-not-resolve.example",
    );
  });
});

// This environment has no E2B credentials, so BROWSER_DRIVER_SCRIPT's actual
// Playwright/host-resolver-rules behavior can't be exercised end-to-end here
// - that remains unverified until it runs against a real sandbox. This test
// is a narrower, honest claim: the exact text shipped to the sandbox is at
// least syntactically valid ESM, so a template-literal escaping slip (e.g. a
// stray backslash in the regexes mirrored from isBlockedIpv6) would fail CI
// instead of only surfacing as a runtime crash inside a live worker task.
describe("BROWSER_DRIVER_SCRIPT (THI-72)", () => {
  it("is syntactically valid ES module source", () => {
    const dir = mkdtempSync(join(tmpdir(), "thismade-driver-script-check-"));
    const scriptPath = join(dir, "driver.mjs");
    try {
      writeFileSync(scriptPath, BROWSER_DRIVER_SCRIPT);
      expect(() => execFileSync(process.execPath, ["--check", scriptPath], { stdio: "pipe" })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wires up host-resolver-rules pinning and a bounded redirect-hop loop", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("--host-resolver-rules=");
    expect(BROWSER_DRIVER_SCRIPT).toContain("context.route(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("isNavigationRequest");
    expect(BROWSER_DRIVER_SCRIPT).toContain("MAX_REDIRECT_HOPS");
  });

  // THI-72 follow-up: page.route() never sees WebSocket connections or
  // window.open() popups, so a scraped/prompt-injected page's own JS could
  // reach an internal/metadata host through either primitive without ever
  // touching the pinning/validation logic above. Asserting the driver source
  // wires up the context-level guards is the same "catch a future regression
  // in the shipped text" pattern as the pinning assertion above.
  it("closes popups, blocks WebSocket connections, and disables service workers", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("context.on(\"page\"");
    expect(BROWSER_DRIVER_SCRIPT).toContain("routeWebSocket(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("serviceWorkers: \"block\"");
  });

  // THI-75: WebRTC ICE gathering and dns-prefetch/preconnect sit outside the
  // request-interception model entirely (no HTTP request for context.route()
  // to ever see), so unlike the checks above these can't be proven by
  // exercising request handling - the same "assert the shipped text wires up
  // the guard" pattern is the best available check without a live sandbox.
  it("disables WebRTC via an init script and a Chromium launch flag", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("addInitScript(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("RTCPeerConnection");
    expect(BROWSER_DRIVER_SCRIPT).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
  });

  it("disables dns-prefetch via a Chromium launch flag and strips speculative <link> tags from every document response", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("--dns-prefetch-disable");
    expect(BROWSER_DRIVER_SCRIPT).toContain("stripSpeculativeLinkTags");
    expect(BROWSER_DRIVER_SCRIPT).toContain("resourceType() === \"document\"");
  });

  // The route.fetch()-based rewrite must never let a redirect response
  // bypass the per-hop DNS-pinning loop above by following it internally -
  // this pins down that the driver text actually guards for that (see
  // allowRequest's maxRedirects: 0 comment), not just that a rewrite exists.
  it("does not let the document-rewrite path swallow a redirect response", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("maxRedirects: 0");
    expect(BROWSER_DRIVER_SCRIPT).toContain("status >= 300 && status < 400");
  });

  // THI-79 Finding 1: stripSpeculativeLinkTags only ever sees the literal
  // response body - it does nothing to stop page JS creating a
  // rel=preconnect|dns-prefetch <link> at runtime via DOM APIs. Assert the
  // shipped text wires up the same init-script interception pattern used for
  // WebRTC above, since this too can't be proven against a real Chromium
  // without live E2B credentials.
  it("neutralizes DOM-injected preconnect/dns-prefetch <link> elements via the same init-script pattern as WebRTC", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("neutralizeSpeculativeLinkElement");
    expect(BROWSER_DRIVER_SCRIPT).toContain("Node.prototype[method]");
    expect(BROWSER_DRIVER_SCRIPT).toContain("HTMLLinkElement.prototype");
    expect(BROWSER_DRIVER_SCRIPT).toContain("Element.prototype.setAttribute");
  });

  // THI-79 Finding 2: the catch blocks around the body-rewrite path and the
  // WebRTC defineProperty lockdown used to swallow every error silently and
  // fall through to an unmodified continue()/no-op. Assert the shipped text
  // distinguishes "fetch itself failed" (safe to fall back) from "we got a
  // response but couldn't rewrite it" (must abort, not silently serve
  // unstripped content), and that both paths - plus the WebRTC lockdown
  // catch - now emit an observable diagnostic instead of swallowing silently.
  it("does not fail open silently: aborts on rewrite failure and surfaces a diagnostic on every catch", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain('route.abort("blockedbyclient")');
    expect(BROWSER_DRIVER_SCRIPT).toContain("diagnostics.push(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("descriptor.configurable !== false");
    expect(BROWSER_DRIVER_SCRIPT).toContain('page.on("console"');
    expect(BROWSER_DRIVER_SCRIPT).toContain("result.diagnostics = diagnostics");
  });

  // THI-80 Finding 1: the appendChild/insertBefore/rel/setAttribute patches
  // above only fire for a <link> built via document.createElement plus a
  // JS-level DOM mutation - none of them fire when the same element is built
  // through the browser's native HTML-fragment parser instead
  // (innerHTML/outerHTML assignment, insertAdjacentHTML,
  // document.write/writeln), which is a full bypass of the DOM-injection
  // guard. Assert the shipped text intercepts all four of those paths and
  // runs their input through the same strip transform as the literal
  // response body.
  it("intercepts innerHTML/outerHTML/insertAdjacentHTML/document.write so markup-parser insertion can't bypass the link guard", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("stripSpeculativeLinkMarkup");
    expect(BROWSER_DRIVER_SCRIPT).toContain('["innerHTML", "outerHTML"]');
    expect(BROWSER_DRIVER_SCRIPT).toContain("Element.prototype.insertAdjacentHTML");
    expect(BROWSER_DRIVER_SCRIPT).toContain('["write", "writeln"]');
    expect(BROWSER_DRIVER_SCRIPT).toContain("Document.prototype[method]");
  });

  // THI-81 Finding 1: document.write/writeln concatenate every argument into
  // one string before parsing (per spec) - sanitizing each argument
  // independently let a page split a <link rel=preconnect> tag across the
  // call boundary so no single argument ever contained a complete tag.
  // Assert the shipped text joins arguments before sanitizing once, and no
  // longer contains the old per-argument-map pattern.
  it("joins document.write/writeln arguments before sanitizing, instead of sanitizing each argument independently", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain('stripSpeculativeLinkMarkup(methodArgs.map(String).join(""))');
    expect(BROWSER_DRIVER_SCRIPT).not.toContain("methodArgs.map(stripSpeculativeLinkMarkup)");
  });

  // THI-80 Finding 2: the page-console diagnostic relay used to match on the
  // static literal "thismade:", which any navigated page could forge itself
  // via console.error, spoofing a "trusted" diagnostic or drowning real ones
  // in noise. Assert the shipped text generates an unpredictable
  // per-invocation token, threads it into addInitScript as a function
  // argument (never assigned to window), and matches on that instead of the
  // old static prefix.
  it("gates the page-console diagnostic relay on an unpredictable per-invocation token instead of a guessable static prefix", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain('import { randomUUID } from "node:crypto"');
    expect(BROWSER_DRIVER_SCRIPT).toContain("const DIAG_TOKEN = randomUUID();");
    expect(BROWSER_DRIVER_SCRIPT).toContain("addInitScript((diagToken) =>");
    expect(BROWSER_DRIVER_SCRIPT).toContain("}, DIAG_TOKEN);");
    expect(BROWSER_DRIVER_SCRIPT).toContain("text.indexOf(DIAG_TOKEN) === 0");
    expect(BROWSER_DRIVER_SCRIPT).not.toContain('text.indexOf("thismade:") === 0');
  });
});

// THI-81 follow-up: every check above only asserts that a literal source
// substring is present in BROWSER_DRIVER_SCRIPT, or (for the
// "is syntactically valid ES module source" test) that the shipped text
// parses - neither actually executes the addInitScript closure's link-guard
// logic. That gap let a real bug ship silently: the closure's regexes are
// plain text inside the outer template literal (not re-parsed as real JS by
// this file's own compiler), so a single-backslash \b/\s in that text goes
// through ordinary string-escape cooking - \b silently becomes an actual
// backspace byte (a defined string escape) and \s silently drops its
// backslash (not a defined string escape) - corrupting the regex into
// something that can never match real HTML, while every existing check above
// still passed. These tests extract the actual shipped function text from
// the evaluated BROWSER_DRIVER_SCRIPT string (the same string a real
// worker's Node process would execute) and run it directly, so a future
// escaping slip in this region fails here instead of only surfacing as a
// live worker task silently letting speculative <link> tags through.
function extractFunctionSource(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in BROWSER_DRIVER_SCRIPT`);
  const braceStart = script.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return script.slice(start, i);
}

describe("BROWSER_DRIVER_SCRIPT addInitScript link guard, executed against the actual shipped text (THI-81)", () => {
  function loadAddInitScriptLinkGuard() {
    const hasBlockedLinkRelSrc = extractFunctionSource(BROWSER_DRIVER_SCRIPT, "hasBlockedLinkRel");
    const stripSpeculativeLinkMarkupSrc = extractFunctionSource(BROWSER_DRIVER_SCRIPT, "stripSpeculativeLinkMarkup");
    // eslint-disable-next-line no-new-func -- deliberately executing the
    // exact text that ships to the sandbox, not a hand-copied stand-in.
    const factory = new Function(
      `${hasBlockedLinkRelSrc}\n${stripSpeculativeLinkMarkupSrc}\nreturn { hasBlockedLinkRel, stripSpeculativeLinkMarkup };`,
    );
    return factory() as { hasBlockedLinkRel: (v: string) => boolean; stripSpeculativeLinkMarkup: (html: string) => string };
  }

  it("actually strips a straightforward preconnect link (would have caught the backslash-escaping bug that made this a silent no-op)", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    expect(stripSpeculativeLinkMarkup('<link rel="preconnect" href="http://169.254.169.254/">')).not.toContain(
      "169.254.169.254",
    );
  });

  it("strips a dns-prefetch link the same way, and leaves an unrelated link untouched", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    expect(stripSpeculativeLinkMarkup('<link rel="dns-prefetch" href="http://169.254.169.254/">')).not.toContain(
      "169.254.169.254",
    );
    const benign = '<link rel="stylesheet" href="/app.css">';
    expect(stripSpeculativeLinkMarkup(benign)).toBe(benign);
  });

  // THI-81 Finding 2 PoC, run against the addInitScript mirror specifically
  // (the top-level allowRequest mirror has its own equivalent test below).
  it("strips a link tag even when an earlier attribute value contains a literal '>' before rel=", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    const html = '<link data-x="foo>bar" rel="preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkMarkup(html)).not.toContain("evil.example");
  });

  // Guards against the decoy-attribute variant of the same bug: a value that
  // merely *contains the text* "rel=" must not shadow the real rel
  // attribute from a naive first-match search.
  it("does not let a decoy attribute value containing the text 'rel=' hide the real rel attribute", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    const html = '<link data-note="rel=bogus" rel="preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkMarkup(html)).not.toContain("evil.example");
  });

  // THI-81 Finding 1 PoC: proves both the fix (join before sanitize) and the
  // bug it replaces (sanitize each argument independently, then join).
  it("document.write-style join-then-sanitize closes the split-tag bypass that sanitize-then-join misses", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    const args = ['<link rel="preconnect" href="http://169.254.169.254/"', ">"];
    expect(stripSpeculativeLinkMarkup(args.map(String).join(""))).not.toContain("169.254.169.254");
    expect(args.map(stripSpeculativeLinkMarkup).join("")).toContain("169.254.169.254");
  });

  // THI-82: see the equivalent Node-side test above for the root cause.
  it("strips a link tag even when an unquoted attribute value contains an unmatched literal quote character", () => {
    const { stripSpeculativeLinkMarkup } = loadAddInitScriptLinkGuard();
    expect(stripSpeculativeLinkMarkup('<link rel=preconnect href=fo"o>')).not.toContain("preconnect");
    expect(stripSpeculativeLinkMarkup("<link rel=preconnect href=abc'def>")).not.toContain("preconnect");
  });
});

describe("BROWSER_DRIVER_SCRIPT allowRequest body-rewrite mirror, executed against the actual shipped text (THI-81)", () => {
  function loadBodyRewriteMirror() {
    const src = extractFunctionSource(BROWSER_DRIVER_SCRIPT, "stripSpeculativeLinkTags");
    // eslint-disable-next-line no-new-func -- see loadAddInitScriptLinkGuard above.
    const factory = new Function(`${src}\nreturn stripSpeculativeLinkTags;`);
    return factory() as (html: string) => string;
  }

  it("strips a link tag even when an earlier attribute value contains a literal '>' before rel=", () => {
    const strip = loadBodyRewriteMirror();
    const html = '<link data-x="foo>bar" rel="preconnect" href="https://evil.example">';
    expect(strip(html)).not.toContain("evil.example");
  });

  it("leaves an unrelated link tag untouched", () => {
    const strip = loadBodyRewriteMirror();
    const benign = '<link rel="stylesheet" href="/app.css">';
    expect(strip(benign)).toBe(benign);
  });

  // THI-82: see the equivalent Node-side test above for the root cause.
  it("strips a link tag even when an unquoted attribute value contains an unmatched literal quote character", () => {
    const strip = loadBodyRewriteMirror();
    expect(strip('<link rel=preconnect href=fo"o>')).not.toContain("preconnect");
    expect(strip("<link rel=preconnect href=abc'def>")).not.toContain("preconnect");
  });
});

// THI-79 Finding 1: hasBlockedLinkRel/neutralizeSpeculativeLinkElement are
// the tested source of truth the driver script's hand-written mirror (same
// functions, inlined as JS text inside BROWSER_DRIVER_SCRIPT's
// addInitScript) has to reproduce - same "test the TS copy directly" pattern
// as planNavigationHop/pinHostname and stripSpeculativeLinkTags above. This
// is the "where testable without live E2B" DOM-injection coverage the
// literal-markup stripSpeculativeLinkTags tests above can't provide, since a
// real DOM-injection repro needs a live Chromium context.route()/LinkLoader
// this environment has no E2B credentials to drive.
describe("hasBlockedLinkRel / neutralizeSpeculativeLinkElement (THI-79)", () => {
  it("flags preconnect and dns-prefetch case-insensitively, including alongside other rel tokens", () => {
    expect(hasBlockedLinkRel("preconnect")).toBe(true);
    expect(hasBlockedLinkRel("PRECONNECT")).toBe(true);
    expect(hasBlockedLinkRel("dns-prefetch")).toBe(true);
    expect(hasBlockedLinkRel("noopener preconnect")).toBe(true);
  });

  it("does not flag unrelated or absent rel values", () => {
    expect(hasBlockedLinkRel("stylesheet")).toBe(false);
    expect(hasBlockedLinkRel("prefetch")).toBe(false);
    expect(hasBlockedLinkRel(null)).toBe(false);
    expect(hasBlockedLinkRel(undefined)).toBe(false);
  });

  function fakeLinkElement(tagName: string, rel: string, href: string): MinimalLinkElement {
    const attrs: Record<string, string> = { rel, href };
    return {
      tagName,
      getAttribute: (name) => attrs[name] ?? null,
      setAttribute: (name, value) => {
        attrs[name] = value;
      },
      removeAttribute: (name) => {
        delete attrs[name];
      },
    };
  }

  it("strips rel and href from a DOM-injected preconnect link (the document.createElement + appendChild bypass)", () => {
    const el = fakeLinkElement("LINK", "preconnect", "https://169.254.169.254/");
    expect(neutralizeSpeculativeLinkElement(el)).toBe(true);
    expect(el.getAttribute("rel")).toBe("");
    expect(el.getAttribute("href")).toBeNull();
  });

  it("strips a dns-prefetch link the same way", () => {
    const el = fakeLinkElement("LINK", "dns-prefetch", "//10.0.0.5/");
    expect(neutralizeSpeculativeLinkElement(el)).toBe(true);
    expect(el.getAttribute("rel")).toBe("");
  });

  it("leaves a non-speculative link element untouched", () => {
    const el = fakeLinkElement("LINK", "stylesheet", "/app.css");
    expect(neutralizeSpeculativeLinkElement(el)).toBe(false);
    expect(el.getAttribute("rel")).toBe("stylesheet");
    expect(el.getAttribute("href")).toBe("/app.css");
  });

  it("only neutralizes LINK elements, even if something else carries a blocked rel value", () => {
    const el = fakeLinkElement("A", "preconnect", "https://evil.example");
    expect(neutralizeSpeculativeLinkElement(el)).toBe(false);
    expect(el.getAttribute("rel")).toBe("preconnect");
  });
});

// THI-75: stripSpeculativeLinkTags is the tested source of truth the driver
// script's hand-written mirror (same function, inlined as JS text inside
// BROWSER_DRIVER_SCRIPT) has to reproduce - same "test the TS copy directly"
// pattern as planNavigationHop/pinHostname above.
describe("stripSpeculativeLinkTags (THI-75)", () => {
  it("strips a preconnect link tag", () => {
    const html = '<head><link rel="preconnect" href="https://evil.example"></head>';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
    expect(stripSpeculativeLinkTags(html)).not.toContain("<link");
  });

  it("strips a dns-prefetch link tag", () => {
    const html = '<link rel="dns-prefetch" href="//evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("strips a preconnect link tag with single-quoted attributes", () => {
    const html = "<link rel='preconnect' href='https://evil.example'>";
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("strips a link tag whose rel contains preconnect alongside other tokens", () => {
    const html = '<link rel="noopener preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("leaves an unrelated link tag (e.g. stylesheet) untouched", () => {
    const html = '<link rel="stylesheet" href="/app.css">';
    expect(stripSpeculativeLinkTags(html)).toBe(html);
  });

  it("leaves a plain prefetch link (not dns-prefetch) untouched", () => {
    const html = '<link rel="prefetch" href="/next-page.html">';
    expect(stripSpeculativeLinkTags(html)).toBe(html);
  });

  it("leaves the rest of the document intact", () => {
    const html = '<html><head><link rel="preconnect" href="https://evil.example"><title>ok</title></head><body>hi</body></html>';
    const stripped = stripSpeculativeLinkTags(html);
    expect(stripped).toContain("<title>ok</title>");
    expect(stripped).toContain("<body>hi</body>");
  });

  // THI-81 Finding 2: the old `[^>]*` tag matcher didn't understand HTML
  // attribute quoting, so a literal `>` inside a quoted attribute value
  // (before rel=) ended the match early and the truncated tag never
  // contained "rel=" - a silent no-op, not just an evadable check.
  it("strips a link tag even when an earlier attribute value contains a literal '>' before rel=", () => {
    const html = '<link data-x="foo>bar" rel="preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  // Decoy-attribute variant of the same class of bug: a value that merely
  // *contains the text* "rel=" must not shadow the real rel attribute from a
  // naive first-match-anywhere-in-the-tag search.
  it("does not let a decoy attribute value containing the text 'rel=' hide the real rel attribute", () => {
    const html = '<link data-note="rel=bogus" rel="preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  // THI-82: the Finding 2 fix's unquoted-value alternative (`[^'">]`)
  // excluded quote characters outright, assuming any quote belongs to a
  // matched quoted span. A stray unescaped quote inside an *unquoted* value
  // is legal per the WHATWG unquoted-attribute-value state - it's just
  // appended to the value, not treated as opening a span or closing the tag
  // - so no alternative could consume it and the whole tag failed to match
  // at all (zero stripping, not truncation).
  it("strips a link tag even when an unquoted attribute value contains an unmatched literal quote character", () => {
    expect(stripSpeculativeLinkTags('<link rel=preconnect href=fo"o>')).not.toContain("preconnect");
    expect(stripSpeculativeLinkTags("<link rel=preconnect href=abc'def>")).not.toContain("preconnect");
  });
});
