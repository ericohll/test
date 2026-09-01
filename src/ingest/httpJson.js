// Thin fetch wrapper shared by the API-pull ingest sources.
//
// `fetch` is resolved as `globalThis.fetch` at call time (not required/bound
// at module load) so tests can stub `global.fetch = jest.fn()` before each
// handler invocation. We use an explicit AbortController + setTimeout
// instead of AbortSignal.timeout(), which is not guaranteed to exist in
// every Jest/node test environment configuration.

async function getJson(url, headers = {}, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doFetch = globalThis.fetch;
    const res = await doFetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Calls urlFn(page) repeatedly starting at page 1, flattening each page's
// items via extract(pageJson), and stops when a page comes back short
// (fewer items than the previous one, or empty) or maxPages is hit.
async function getPaged(urlFn, headers = {}, { maxPages = 20, extract } = {}) {
  const items = [];
  let page = 1;
  let prevLength = null;
  while (page <= maxPages) {
    const json = await getJson(urlFn(page), headers);
    const pageItems = extract(json) || [];
    items.push(...pageItems);
    if (pageItems.length === 0) break;
    if (prevLength !== null && pageItems.length < prevLength) break;
    prevLength = pageItems.length;
    page += 1;
  }
  return items;
}

module.exports = { getJson, getPaged };
