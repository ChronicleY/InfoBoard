export class SSOExpiredError extends Error {
  constructor() {
    super("SSO session expired. Please log in to www1.szu.edu.cn.");
    this.name = "SSOExpiredError";
  }
}

async function fetchAndCheck(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: "include" });

  // Check for SSO redirect
  if (response.redirected && response.url.includes("caslogin")) {
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
  if (html.includes("统一身份认证平台") || html.includes("casLoginForm")) {
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
    const response = await fetch("https://www1.szu.edu.cn/", {
      credentials: "include",
      redirect: "manual",
    });

    console.log(`[fetcher] SSO check: status=${response.status}, type=${response.type}`);

    // If redirected to CAS login, session is expired
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      console.log(`[fetcher] SSO redirect to: ${location}`);
      if (location.includes("cas") || location.includes("login")) {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error("[fetcher] SSO check failed:", err);
    return false;
  }
}
