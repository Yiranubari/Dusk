pub mod instructions;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("DcqNBKGGXjaLXGftVsxXUrpePY9GU65UcDiPikDUtH35");

#[program]
pub mod market_state {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle(ctx)
    }
}
