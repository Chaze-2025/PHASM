// Read-only public publication policy around the existing application build.
import application from "../../dist/phasm/index.js";

const publicHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

function response(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...publicHeaders,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function blockedPath(rawPath) {
  let path = rawPath;
  try {
    for (let index = 0; index < 3; index++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch {
    return true;
  }
  path = path.replaceAll("\\", "/").toLowerCase();
  return (
    /^\/(?:api\/)?admin(?:\/|$)/.test(path) ||
    /^\/(?:@vite|@fs|@id|@react-refresh|__open-in-editor|__debug|src|worker|shared|migrations|scripts|tests|content|node_modules)(?:\/|$)/.test(
      path,
    ) ||
    /^\/__vite[^/]*(?:\/|$)/.test(path) ||
    /^\/cdn-cgi\/(?:local(?:\/|$)|explorer[^/]*(?:\/|$))/.test(path) ||
    /(?:^|\/)\.[^/]+/.test(path) ||
    /^\/(?:wrangler|vite\.config|tsconfig|package(?:-lock)?)(?:\.|\/|$)/.test(
      path,
    ) ||
    /\.map$/.test(path)
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (blockedPath(url.pathname)) return response("Not found.", 404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const community =
        /^\/api\/(?:reviews|submissions|suggestions|uploads)(?:\/|$)/.test(
          url.pathname,
        );
      return response(
        JSON.stringify({
          error: community
            ? "Community submissions are not enabled."
            : "The public site is read-only.",
        }),
        community ? 403 : 405,
        {
          "Content-Type": "application/json; charset=utf-8",
          ...(community ? {} : { Allow: "GET, HEAD" }),
        },
      );
    }
    // Never pass administrative credentials or extra bindings to the application.
    const result = await application.fetch(request, {
      DB: env.DB,
      ASSETS: env.ASSETS,
      SITE_URL: env.SITE_URL,
    });
    const secured = new Response(
      request.method === "HEAD" ? null : result.body,
      result,
    );
    for (const [name, value] of Object.entries(publicHeaders))
      secured.headers.set(name, value);
    return secured;
  },
};
