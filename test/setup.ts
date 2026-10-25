/**
 * Offline guarantee: any test that tries to reach a real host fails loudly.
 * Tests inject their own fetch; this catches the ones that forget.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Network access in tests is forbidden: ${url.hostname}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
