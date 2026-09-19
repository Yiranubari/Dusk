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

    #[doc(hidden)]
    pub price_feed: Option<UncheckedAccount<'info>>,

    pub stock_mint: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<InitializeMarket>,
    market_id: String,
    confidence_threshold: u64,
    max_feed_age: i64,
) -> Result<()> {
    require!(
        market_id.len() <= Market::MAX_MARKET_ID_LEN,
        MarketStateErrorCode::MarketIdTooLong
    );

    let stock_mint = ctx.accounts.stock_mint.as_ref().ok_or(MarketStateErrorCode::InvalidStockMint)?;
    require!(stock_mint.key() != Pubkey::default(), MarketStateErrorCode::InvalidStockMint);
    ctx.accounts.market.stock_mint = stock_mint.key();

    ctx.accounts.market.market_id = market_id;
    ctx.accounts.market.authority = *ctx.accounts.authority.key;
    ctx.accounts.market.state = MarketState::Stale;
    ctx.accounts.market.created_at = Clock::get()?.unix_timestamp;
    ctx.accounts.market.last_update_ts = Clock::get()?.unix_timestamp;

    if let Some(price_feed) = &ctx.accounts.price_feed {
        let account_data = price_feed.try_borrow_data()?;
        if account_data.len() >= 4 {
            let magic: [u8; 4] = [account_data[0], account_data[1], account_data[2], account_data[3]];
            if magic == [0x20, 0x74, 0x03, 0x12] || magic == [0x22, 0xf1, 0x23, 0x63] {
                ctx.accounts.market.price_feed = price_feed.key();
            } else {
                return Err(MarketStateErrorCode::InvalidPriceFeed.into());
            }
        }
    }
    ctx.accounts.market.confidence_threshold = confidence_threshold;
    ctx.accounts.market.max_feed_age = max_feed_age;
    ctx.accounts.market.is_paused = false;

    Ok(())
}
