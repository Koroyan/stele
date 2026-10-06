/** API response shapes shared by dashboard pages. */

export interface DocumentRow {
  id: string;
  address: string;
  slug: string;
  documentType: string;
  locale: string;
  versionCount: number;
  currentVersionAddress: string | null;
  acceptanceCount: number;
  currentVersion: {
    number: number;
    versionLabel: string;
    title: string;
    publishedAt: string;
    effectiveAt: number | null;
  } | null;
}
