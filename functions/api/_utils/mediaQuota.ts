// Shared cap so the list endpoint (reporting usage) and the upload
// endpoint (enforcing it) can never drift out of sync with each other.
export const MEDIA_QUOTA_BYTES = 100 * 1024 * 1024; // 100MB
