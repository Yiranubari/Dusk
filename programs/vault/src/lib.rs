pub mod collateral;
pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use collateral::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("AB41HEqA7PfEbysT5c9DX7A9MNa65GDpG397CoN5cj3z");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle(ctx, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        instructions::borrow::handle(ctx, amount)
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handle(ctx)
    }

    pub fn mint_option(ctx: Context<MintOption>, strike_price: u64, expiry_timestamp: i64) -> Result<()> {
        instructions::mint_option::handle(ctx, strike_price, expiry_timestamp)
    }

    pub fn settle_option(ctx: Context<SettleOption>) -> Result<()> {
        instructions::settle_option::handle(ctx)
    }

    pub fn setup_stream(
        ctx: Context<SetupStream>,
        recipient: Pubkey,
        start: i64,
        end: i64,
        cliff: i64,
        amount: u64,
        revocable: bool,
    ) -> Result<()> {
        instructions::setup_stream::handle(ctx, recipient, start, end, cliff, amount, revocable)
    }

    pub fn claim_stream(ctx: Context<ClaimStream>) -> Result<()> {
        instructions::claim_stream::handle(ctx)
    }

    pub fn revoke_stream(ctx: Context<RevokeStream>) -> Result<()> {
        instructions::revoke_stream::handle(ctx)
    }
}