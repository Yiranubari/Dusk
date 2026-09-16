use anchor_lang::prelude::*;
use crate::state::Market;
use crate::state::MarketState;
use crate::errors::MarketStateErrorCode;

#[derive(Accounts)]
#[instruction(market_id: String)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", market_id.as_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<InitializeMarket>,
    market_id: String,
) -> Result<()> {
    require!(
        market_id.len() <= Market::MAX_MARKET_ID_LEN,
        MarketStateErrorCode::MarketIdTooLong
    );

    ctx.accounts.market.market_id = market_id;
    ctx.accounts.market.authority = *ctx.accounts.authority.key;
    ctx.accounts.market.state = MarketState::Stale;
    ctx.accounts.market.last_update_ts = Clock::get()?.unix_timestamp;
    ctx.accounts.market.created_at = Clock::get()?.unix_timestamp;

    Ok(())
}
