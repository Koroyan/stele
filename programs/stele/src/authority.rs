//! Authorization rules for organization-scoped instructions (PROTOCOL_SPEC.md §6.4).
//!
//! Every privileged instruction calls exactly one of these helpers. Membership accounts are
//! PDA-verified by the instruction's account constraints *and* re-checked here (defence in depth).

use anchor_lang::prelude::*;
use stele_core::constants::{ROLE_ADMIN, ROLE_PUBLISHER};

use crate::error::SteleError;
use crate::state::{Member, Organization};

/// How a signer was authorized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Owner,
    /// An active member; carries the member's role bits.
    Member(u8),
}

/// Roles of `authority` in `organization` if `membership` is its active member record.
fn active_member_roles(
    organization: &Pubkey,
    authority: &Pubkey,
    membership: Option<&Member>,
) -> Option<u8> {
    match membership {
        Some(m) if m.organization == *organization && m.member == *authority && m.is_active() => {
            Some(m.roles)
        }
        _ => None,
    }
}

/// Owner (not recovery-locked) or an active member holding any of `roles`, subject to freeze
/// rules: members are blocked by any freeze; the owner only by a recovery lock — unless
/// `blocked_when_frozen` is set (publication-class actions), which blocks everyone while frozen.
pub fn authorize(
    org: &Organization,
    org_key: &Pubkey,
    authority: &Pubkey,
    membership: Option<&Member>,
    roles: u8,
    blocked_when_frozen: bool,
) -> Result<Actor> {
    if blocked_when_frozen {
        require!(!org.frozen, SteleError::OrganizationFrozen);
    }
    if org.is_owner(authority) {
        require!(
            !org.is_recovery_locked(),
            SteleError::OrganizationLockedByRecovery
        );
        return Ok(Actor::Owner);
    }
    let member_roles =
        active_member_roles(org_key, authority, membership).ok_or(SteleError::Unauthorized)?;
    require!(member_roles & roles != 0, SteleError::Unauthorized);
    require!(!org.frozen, SteleError::OrganizationFrozen);
    Ok(Actor::Member(member_roles))
}

/// The organization owner, provided the organization is not locked by its recovery authority.
pub fn require_owner(org: &Organization, authority: &Pubkey) -> Result<()> {
    require!(org.is_owner(authority), SteleError::Unauthorized);
    require!(
        !org.is_recovery_locked(),
        SteleError::OrganizationLockedByRecovery
    );
    Ok(())
}

/// Member-management rule: the owner may manage anyone; an admin may manage only non-admin
/// members and may not grant the ADMIN role.
pub fn authorize_member_management(
    org: &Organization,
    org_key: &Pubkey,
    authority: &Pubkey,
    membership: Option<&Member>,
    target_current_roles: u8,
    target_new_roles: u8,
) -> Result<Actor> {
    let actor = authorize(org, org_key, authority, membership, ROLE_ADMIN, false)?;
    if let Actor::Member(_) = actor {
        require!(
            target_current_roles & ROLE_ADMIN == 0 && target_new_roles & ROLE_ADMIN == 0,
            SteleError::CannotManageAdmin
        );
    }
    Ok(actor)
}

/// Roles allowed to create documents.
pub const DOCUMENT_CREATOR_ROLES: u8 = ROLE_ADMIN | ROLE_PUBLISHER;
/// Roles allowed to publish versions.
pub const PUBLISHER_ROLES: u8 = ROLE_PUBLISHER;
/// Roles allowed to manage nonce shards.
pub const SHARD_MANAGER_ROLES: u8 = ROLE_ADMIN;
