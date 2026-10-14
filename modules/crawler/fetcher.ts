const BOARD_HOME = "https://www1.szu.edu.cn/board/";

/** The session is genuinely gone — the request landed on the CAS login gate. */
export class SSOExpiredError extends Error {
  constructor(url: string) {
    super(`SSO session expired while fetching ${url}. Please log in to www1.szu.edu.cn.`);
    this.name = "SSOExpiredError";
  }
}

/**
 * The server redirected somewhere we did not expect (deleted post, anti-bot
 * interstitial, http→https bounce, …). This is NOT necessarily a login failure,
 * so callers that fetch individual articles must treat it as a skip rather than
 * tearing down the whole crawl.
 */
export class BoardRedirectError extends Error {
  constructor(url: string) {
    super(`Unexpected redirect while fetching ${url}`);
    this.name = "BoardRedirectError";
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

function decodeBoardHtml(buffer: ArrayBuffer): string {
  // The board serves GB2312/GBK. Decode with GBK first, fall back to UTF-8 when
  // the page turns out to be unicode (lots of replacement characters).
  let html = new TextDecoder("gbk", { fatal: false }).decode(buffer);
  const replacementCount = (html.match(/\uFFFD/g) || []).length;
  if (replacementCount > 5) {
    html = new TextDecoder("utf-8").decode(buffer);
  }
  return html;
}

/**
 * Fetch a board page with the current session.
 *
 * Throws {@link SSOExpiredError} when the request hits the CAS login gate, and
 * {@link BoardRedirectError} for any other redirect.
 */
export async function fetchBoardPage(url: string): Promise<string> {
  console.log(`[fetcher] Fetching: ${url}`);
  const response = await fetch(url, { credentials: "include", redirect: "manual" });

  if (isRedirectResponse(response)) {
    throw new BoardRedirectError(url);
  }

  const buffer = await response.arrayBuffer();
  const html = decodeBoardHtml(buffer);
  console.log(`[fetcher] Response: ${buffer.byteLength} bytes`);

  if (hasLoginForm(html)) {
    throw new SSOExpiredError(url);
  }

  return html;
}

/**
 * Probe whether the current session can access the board.
 * Uses the same GBK decoding path as the crawler so the two never disagree.
 */
export async function checkSSO(): Promise<boolean> {
  try {
    console.log("[fetcher] Checking SSO status...");
    await fetchBoardPage(BOARD_HOME);
    console.log("[fetcher] SSO check: session valid");
    return true;
  } catch (err) {
    console.log("[fetcher] SSO check: session unavailable:", String(err));
    return false;
  }
}
