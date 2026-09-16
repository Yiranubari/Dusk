use anchor_lang::prelude::*;
use borsh::BorshDeserialize;
use crate::state::Market;
use crate::state::MarketState;
use crate::state::PythPrice;
use crate::errors::MarketStateErrorCode;

#[derive(Accounts)]
pub struct UpdateMarketState<'info> {
    #[account(
        mut,
        has_one = authority @ MarketStateErrorCode::Unauthorized,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[doc(hidden)]
    pub price_feed: Option<UncheckedAccount<'info>>,
}

pub fn handle_update(
    ctx: Context<UpdateMarketState>,
    new_state: MarketState,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    if let Some(price_feed_acct) = &ctx.accounts.price_feed {
        let account_data = price_feed_acct.try_borrow_data()?;
        if account_data.len() >= 4 {
            let magic: [u8; 4] = [account_data[0], account_data[1], account_data[2], account_data[3]];
            if magic == [0x20, 0x74, 0x03, 0x12] {
                let price_info = PythPrice::deserialize(&mut &account_data[..])?;
                let confidence = price_info.conf;
                if confidence > ctx.accounts.market.confidence_threshold {
                    ctx.accounts.market.state = MarketState::Stale;
                    ctx.accounts.market.last_update_ts = now;
                    return Ok(());
                }

                let feed_age = now - price_info.timestamp;
                if feed_age > ctx.accounts.market.max_feed_age {
                    ctx.accounts.market.state = MarketState::Stale;
                    ctx.accounts.market.last_update_ts = now;
                    return Ok(());
                }
            }
        }
    }

    let has_price_feed = ctx.accounts.price_feed.is_some();

    if !has_price_feed {
        ctx.accounts.market.state = new_state;
    } else if new_state != MarketState::Stale {
        ctx.accounts.market.state = new_state;
    }

    ctx.accounts.market.last_update_ts = now;
    Ok(())
}
