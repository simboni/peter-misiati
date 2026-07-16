export const dynamic = "force-dynamic";
import { getEnv } from "@/server/config";

/**
 * Serves Digital Asset Links for the Android app (Trusted Web Activity), mapped
 * from /.well-known/assetlinks.json via a rewrite in next.config.ts.
 *
 * We serve it from the app rather than a static public/.well-known file because
 * Cloudflare Workers static assets can skip dot-directories, which would 404 the
 * file and break TWA verification.
 *
 * Configure without a code change by setting Worker vars:
 *   ASSETLINKS_SHA256   comma-separated SHA-256 signing fingerprint(s) from Play
 *   TWA_PACKAGE_NAME    the Android package id (default ke.co.tallypay.app)
 */
export async function GET() {
  const env = (await getEnv()) as unknown as Record<string, string | undefined>;
  const fingerprints = (env.ASSETLINKS_SHA256 || "REPLACE_WITH_YOUR_PLAY_APP_SIGNING_SHA256_FINGERPRINT")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const packageName = env.TWA_PACKAGE_NAME || "ke.co.tallypay.app";

  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}
