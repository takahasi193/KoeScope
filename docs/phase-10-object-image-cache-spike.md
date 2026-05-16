# Phase 10 Object Image Cache Spike

This spike evaluates a future public object cache for work covers and activity banners. It keeps the existing local image cache under `public/cache/` as the default runtime behavior and preserves each original DLsite image URL as the fallback display URL.

## Current Boundary

- `publicObjectImageKey(remoteUrl, { type })` derives a provider-neutral object key from the normalized public image URL.
- `resolvePublicObjectImage(remoteUrl, { publicBaseUrl })` returns an object-cache URL only when a safe HTTPS public base URL is configured.
- Without a configured object base URL, or with invalid input, the resolver returns the normalized remote DLsite image URL or an empty image result.
- The helper does not upload, delete, list, or sign objects. Provider write paths remain a later task.

## Provider Evaluation

### Vercel Blob

Vercel Blob is the lowest-friction option if the public frontend and read API stay on Vercel. It gives a managed object store with a public URL model that fits the current `publicBaseUrl + objectKey` resolver.

Fit: simplest Vercel prototype and likely best first hosted smoke test. Tradeoff: it is tied to Vercel's storage product and future local-first sync still needs an export/upload step.

Source:
- https://vercel.com/docs/vercel-blob/server-upload

### Cloudflare R2

R2 is attractive for public images because it supports S3-compatible APIs and public bucket/custom-domain access. It also avoids tying the image cache to the Vercel deployment if the read API later stays provider-neutral.

Fit: strong independent object store for public covers/banners. Tradeoff: needs bucket policy/custom-domain configuration and a separate upload credential path.

Sources:
- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/buckets/public-buckets/

### S3-Compatible Storage

Amazon S3 and compatible providers are the most portable baseline. The stable object-key contract in `publicObjectImageKey()` maps cleanly to bucket object keys, and public or CDN-fronted object URLs can be represented by the same `publicBaseUrl`.

Fit: broadest provider compatibility. Tradeoff: requires the most explicit policy, CDN, cache-control, and credential decisions.

Source:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html

## Recommendation

Keep the app on local image cache for now. For the first hosted image-cache smoke test, use Vercel Blob if the Vercel prototype is the only cloud surface. Prefer Cloudflare R2 if public images should remain independent from Vercel. Keep the object key contract provider-neutral so either path can preserve the same DLsite remote URL fallback.
