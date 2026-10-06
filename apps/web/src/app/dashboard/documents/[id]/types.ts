export interface VersionRow {
  id: string;
  address: string;
  number: number;
  versionHash: string;
  contentHash: string;
  previousVersionHash: string | null;
  title: string;
  versionLabel: string;
  effectiveAt: number | null;
  publishedAt: string;
  publishedSlot: number;
  publisherAddress: string;
  publisherRole: number;
  storageUri: string;
  publishTx: string | null;
  finalized: boolean;
  acceptanceCount: number;
}

export interface DraftRow {
  id: string;
  documentId: string;
  title: string;
  versionLabel: string;
  effectiveAt: number | null;
  source: string;
  changeSummary: string | null;
  status: "draft" | "prepared" | "published" | "abandoned";
  preparedVersionNumber: number | null;
  preparedContentHash: string | null;
  preparedVersionHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocDetail {
  document: {
    id: string;
    address: string;
    slug: string;
    documentType: string;
    locale: string;
    versionCount: number;
    headHash: string | null;
    currentVersionAddress: string | null;
  };
  organization: { id: string; address: string; name: string; verifiedDomain: string | null };
  role: string;
  versions: VersionRow[];
  drafts: DraftRow[];
}

export interface Publication {
  draftId: string;
  organization: string;
  document: string;
  programId: string;
  chainId: string;
  versionNumber: number;
  versionAccount: string;
  previousVersionHash: string;
  title: string;
  versionLabel: string;
  effectiveAt: number;
  canonicalContent: string;
  contentHash: string;
  storageUri: string;
  versionJson: string;
  versionHash: string;
}
