/**
 * The WeChat group QR code shown in Settings → About → Join community is a
 * single ops-managed image stored in the `LORO_DOCUMENTS` R2 bucket and served
 * publicly by the server worker (same model as avatars, but a fixed key
 * instead of an opaque id so ops can rotate it in place).
 *
 * Upload / rotate the image with wrangler (no deploy needed):
 *
 *   pnpm wrangler r2 object put loro-docs/community/wechat-group-qr \
 *     --file ./wechat-qr.png --content-type image/png --remote --env production
 *
 * (staging uses the `loro-docs-preview` bucket instead).
 */
export const COMMUNITY_WECHAT_QR_API_PATH = '/api/community/wechat-qr';
export const COMMUNITY_WECHAT_QR_OBJECT_KEY = 'community/wechat-group-qr';
// WeChat group invite codes expire and the object is re-uploaded under the
// same key, so cache briefly instead of the immutable avatar policy.
export const COMMUNITY_WECHAT_QR_CACHE_CONTROL = 'public, max-age=300';
