/** Google Ads UI links (pure; shared by server and client). Links only, never an API call. */
export const OCID_RE = /^\d{4,20}$/;

/** Accepts a pasted Google Ads URL (or bare digits) and returns only the ocid, or null when invalid. */
export function parseOcid(input: string): string | null {
  const s = input.trim();
  if (OCID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)ads\.google\.com$/i.test(u.hostname)) return null;
    let o = u.searchParams.get("ocid");
    if (!o) {
      // Login wrapper: /um/identity?dst=/aw/...?ocid=...
      const dst = u.searchParams.get("dst");
      if (dst) o = new URL(dst, "https://ads.google.com").searchParams.get("ocid");
    }
    return o && OCID_RE.test(o) ? o : null;
  } catch {
    return null;
  }
}

/**
 * Google customer id (10 digits) of a directory row. customer_id_dashed may be a label such as
 * "444-791-2752 · MCC 532-145-0531" (MCC import), so take the first CID-shaped group, never all digits.
 */
export function cidOf(customerIdDashed: string | null | undefined, clientId?: string | null): string | null {
  for (const s of [customerIdDashed, clientId]) {
    const v = String(s || "");
    if (/^MCC\b/i.test(v.trim())) continue; // only the manager id is known
    const m = v.match(/(?<!\d)(\d{3})-?(\d{3})-?(\d{4})(?!\d)/);
    if (m) return m[1] + m[2] + m[3];
  }
  return null;
}

/** Builds the link: saved ocid → clean overview URL (no authuser/__u/euid/uscid/__c/ascid); else the __e account chooser. */
export function googleAdsUrl(cidRaw: string | null | undefined, ocid: string | null | undefined): string | null {
  if (ocid && OCID_RE.test(ocid)) return `https://ads.google.com/aw/overview?ocid=${ocid}`;
  const cid = cidOf(cidRaw);
  if (!cid) return null;
  return `https://ads.google.com/um/identity?dst=${encodeURIComponent(`/aw/overview?__e=${cid}`)}`;
}

export const isGoogleId = (id: string) => !id.startsWith("fb_") && !id.startsWith("oa_") && !id.startsWith("tt_");
