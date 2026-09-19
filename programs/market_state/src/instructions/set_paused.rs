use anchor_lang::prelude::*;
use crate::state::Market;
use crate::errors::MarketStateErrorCode;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        has_one = authority @ MarketStateErrorCode::Unauthorized,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn handle_set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.market.is_paused = paused;
    ctx.accounts.market.last_update_ts = Clock::get()?.unix_timestamp;
    Ok(())
}
