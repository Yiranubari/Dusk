use anchor_lang::prelude::*;
use crate::state::Market;
use crate::state::MarketState;
use crate::errors::MarketStateErrorCode;

#[derive(Accounts)]
pub struct UpdateMarketState<'info> {
    #[account(
        mut,
        has_one = authority @ MarketStateErrorCode::Unauthorized,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn handle_update(
    ctx: Context<UpdateMarketState>,
    new_state: MarketState,
) -> Result<()> {
    ctx.accounts.market.state = new_state;
    ctx.accounts.market.last_update_ts = Clock::get()?.unix_timestamp;

    Ok(())
}