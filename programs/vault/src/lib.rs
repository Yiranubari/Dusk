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
}