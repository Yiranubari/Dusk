pub mod errors;
pub mod state;
pub mod instructions;

use anchor_lang::prelude::*;

pub use errors::*;
pub use state::*;
pub use instructions::*;

declare_id!("DcqNBKGGXjaLXGftVsxXUrpePY9GU65UcDiPikDUtH35");

#[program]
pub mod market_state {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: String,
    ) -> Result<()> {
        instructions::initialize_market::handle_initialize(ctx, market_id)
    }

    pub fn update_market_state(
        ctx: Context<UpdateMarketState>,
        new_state: MarketState,
    ) -> Result<()> {
        instructions::update_market_state::handle_update(ctx, new_state)
    }
}