export class SSOExpiredError extends Error {
  constructor() {
    super("SSO session expired. Please log in to www1.szu.edu.cn.");
    this.name = "SSOExpiredError";
  }
}

// Chromium returns an opaque-redirect response (status 0, unreadable headers)
// for redirect:"manual" fetches, so a redirect can only be detected by type/status.
function isRedirectResponse(response: Response): boolean {
  return (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400)
  );
}

function hasLoginForm(text: string): boolean {
  return text.includes("统一身份认证平台") || text.includes("casLoginForm");
}

async function fetchAndCheck(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: "include", redirect: "manual" });

  // Not logged in: the board redirects to the CAS login page
  if (isRedirectResponse(response)) {
    throw new SSOExpiredError();
  }

  return response;
}

export async function fetchBoardPage(url: string): Promise<string> {
  console.log(`[fetcher] Fetching: ${url}`);
  const response = await fetchAndCheck(url);

  const buffer = await response.arrayBuffer();
  console.log(`[fetcher] Response: ${buffer.byteLength} bytes`);
  // Try GBK first (SZUniv board uses GB2312/GBK), fall back to UTF-8
  const decoder = new TextDecoder("gbk", { fatal: false });
  let html = decoder.decode(buffer);

  // Check for CAS login form in HTML
  if (hasLoginForm(html)) {
    throw new SSOExpiredError();
  }

  // Quick mojibake detection — if lots of replacement chars, retry UTF-8
  const replacementCount = (html.match(/�/g) || []).length;
  if (replacementCount > 5) {
    const utf8Decoder = new TextDecoder("utf-8");
    html = utf8Decoder.decode(buffer);
  }

  return html;
}

export async function checkSSO(): Promise<boolean> {
  try {
    console.log("[fetcher] Checking SSO status...");
    const response = await fetch("https://www1.szu.edu.cn/board/", {
      credentials: "include",
      redirect: "manual",
    });

    console.log(`[fetcher] SSO check: status=${response.status}, type=${response.type}`);

    // Redirect to CAS login means the session is expired
    if (isRedirectResponse(response)) {
      return false;
    }

    // Also check body content for login form (some SSO setups don't redirect)
    if (response.status === 200) {
      const text = await response.text();
      if (hasLoginForm(text)) {
        console.log("[fetcher] SSO check: login form detected in body");
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error("[fetcher] SSO check failed:", err);
    return false;
  }
}
