/** Human-readable names for audit-log actions. Unknown actions fall back to their identifier. */
const ACTIONS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "organization.synced": "Organization linked to dashboard",
  "organization.settings_updated": "Organization settings changed",
  "member.labelled": "Member label changed",
  "shard.created": "Acceptance shard created",
  "domain.verification_requested": "Domain verification requested",
  "domain.verified": "Domain verified and attested on-chain",
  "domain.revoked": "Domain attestation revoked",
  "domain.renewed": "Domain attestation renewed",
  "document.created": "Document created",
  "draft.created": "Draft created",
  "version.publication_requested": "Publication prepared",
  "version.published": "Version published",
  "gate.policy_created": "Gate policy created",
  "gate.policy_requirement_changed": "Gate policy now requires a new version",
  "gate.program_registered": "Program registered with Gate",
  "gate.program_removed": "Program removed from Gate",
  "api_key.created": "API key created",
  "api_key.revoked": "API key revoked",
  "webhook.created": "Webhook endpoint added",
  "webhook.updated": "Webhook endpoint updated",
  "webhook.secret_rotated": "Webhook secret rotated",
  "webhook.deleted": "Webhook endpoint deleted",
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function rolesLabel(roles: number): string {
  const out: string[] = [];
  if (roles & 1) out.push("Admin");
  if (roles & 2) out.push("Publisher");
  return out.join(" · ") || "No role";
}
