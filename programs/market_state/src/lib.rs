pub mod errors;
pub mod state;
pub mod instructions;

use anchor_lang::prelude::*;

pub use errors::*;
pub use state::*;
pub use instructions::*;

declare_id!("5nHB2F1c5fzXiiUwpQqY6RT6nXfboQfMGiBnMSkCAJc9");

#[program]
pub mod market_state {
    use super::*;

        pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: String,
        confidence_threshold: u64,
        max_feed_age: i64,
    ) -> Result<()> {
        instructions::initialize_market::handle_initialize(ctx, market_id, confidence_threshold, max_feed_age)
    }

    pub fn update_market_state(
        ctx: Context<UpdateMarketState>,
        new_state: MarketState,
    ) -> Result<()> {
        instructions::update_market_state::handle_update(ctx, new_state)
    }
}