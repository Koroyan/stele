//! Protocol configuration: one-time initialization by the upgrade authority, pause switch, domain
//! attestor rotation and two-step admin transfer. `chain_id`/`network_label` are immutable.

use anchor_lang::prelude::*;
use stele_core::validate::{validate_chain_id, validate_network_label};

use crate::constants::CONFIG_SEED;
use crate::error::SteleError;
use crate::events::*;
use crate::program::Stele;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    pub admin: Pubkey,
    pub domain_attestor: Pubkey,
    pub chain_id: String,
    pub network_label: String,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    /// Must be the program's upgrade authority — prevents initialization front-running.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ SteleError::InvalidProgramData
    )]
    pub program: Program<'info, Stele>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ SteleError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_protocol(
    ctx: Context<InitializeProtocol>,
    args: InitializeProtocolArgs,
) -> Result<()> {
    validate_chain_id(&args.chain_id).map_err(|_| SteleError::InvalidChainId)?;
    validate_network_label(&args.network_label).map_err(|_| SteleError::InvalidNetworkLabel)?;
    require_keys_neq!(args.admin, Pubkey::default(), SteleError::ZeroAddress);
    require_keys_neq!(
        args.domain_attestor,
        Pubkey::default(),
        SteleError::ZeroAddress
    );

    let config = &mut ctx.accounts.config;
    config.admin = args.admin;
    config.pending_admin = Pubkey::default();
    config.domain_attestor = args.domain_attestor;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.chain_id = args.chain_id.clone();
    config.network_label = args.network_label.clone();

    emit!(ProtocolInitialized {
        admin: args.admin,
        domain_attestor: args.domain_attestor,
        chain_id: args.chain_id,
        network_label: args.network_label,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ProtocolAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn set_protocol_paused(ctx: Context<ProtocolAdmin>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require_keys_eq!(
        ctx.accounts.admin.key(),
        config.admin,
        SteleError::Unauthorized
    );
    config.paused = paused;
    emit!(ProtocolPauseChanged {
        paused,
        admin: config.admin
    });
    Ok(())
}

pub fn set_domain_attestor(ctx: Context<ProtocolAdmin>, attestor: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require_keys_eq!(
        ctx.accounts.admin.key(),
        config.admin,
        SteleError::Unauthorized
    );
    require_keys_neq!(attestor, Pubkey::default(), SteleError::ZeroAddress);
    let previous = config.domain_attestor;
    config.domain_attestor = attestor;
    emit!(DomainAttestorChanged { previous, attestor });
    Ok(())
}

pub fn propose_protocol_admin(ctx: Context<ProtocolAdmin>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require_keys_eq!(
        ctx.accounts.admin.key(),
        config.admin,
        SteleError::Unauthorized
    );
    require_keys_neq!(new_admin, Pubkey::default(), SteleError::ZeroAddress);
    config.pending_admin = new_admin;
    emit!(ProtocolAdminProposed {
        admin: config.admin,
        proposed: new_admin
    });
    Ok(())
}

pub fn accept_protocol_admin(ctx: Context<ProtocolAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require_keys_neq!(
        config.pending_admin,
        Pubkey::default(),
        SteleError::NoPendingOwner
    );
    require_keys_eq!(
        ctx.accounts.admin.key(),
        config.pending_admin,
        SteleError::Unauthorized
    );
    let previous = config.admin;
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    emit!(ProtocolAdminChanged {
        previous,
        admin: config.admin
    });
    Ok(())
}
