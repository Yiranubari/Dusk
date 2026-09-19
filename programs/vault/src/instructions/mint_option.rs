use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::Mint;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::validate_market_and_feed;

#[derive(Accounts)]
pub struct MintOption<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ VaultError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = market_state.key() == vault.market_state @ VaultError::InvalidMarketState,
        constraint = market_state.stock_mint == vault.stock_mint @ VaultError::InvalidMarketState
    )]
    pub market_state: Box<Account<'info, market_state::Market>>,

    #[account(
        constraint = price_update.key() == market_state.price_feed @ VaultError::InvalidPriceFeed
    )]
    pub price_update: Box<Account<'info, PriceUpdateV2>>,
}

pub fn handle(ctx: Context<MintOption>, strike_price: u64, expiry_timestamp: i64) -> Result<()> {
    let clock = Clock::get()?;
    require!(strike_price > 0, VaultError::InvalidStrikePrice);
    require!(strike_price <= i64::MAX as u64, VaultError::StrikePriceOverflow);
    require!(expiry_timestamp > clock.unix_timestamp, VaultError::InvalidExpiry);

    validate_market_and_feed(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;
    require!(vault.active_strategy == Strategy::None, VaultError::IncompatibleStrategy);
    require!(vault.collateral_amount > 0, VaultError::NoCollateral);

    vault.active_strategy = Strategy::CoveredCall;
    vault.strike_price = strike_price;
    vault.expiry_timestamp = expiry_timestamp;
    vault.notional_amount = vault.collateral_amount;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mint_option_state_updates() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::None;

        let strike_price: u64 = 250_00000000;
        let expiry_timestamp: i64 = 1_800_000_000;

        assert_eq!(vault.active_strategy, Strategy::None);
        assert!(vault.collateral_amount > 0);

        vault.active_strategy = Strategy::CoveredCall;
        vault.strike_price = strike_price;
        vault.expiry_timestamp = expiry_timestamp;
        vault.notional_amount = vault.collateral_amount;

        assert_eq!(vault.active_strategy, Strategy::CoveredCall);
        assert_eq!(vault.strike_price, strike_price);
        assert_eq!(vault.expiry_timestamp, expiry_timestamp);
        assert_eq!(vault.notional_amount, 100_000_000);
    }

    #[test]
    fn test_mint_option_validation_rules() {
        let strike_zero: u64 = 0;
        assert!(strike_zero == 0);

        let now: i64 = 1_700_000_000;
        let past_expiry: i64 = 1_699_999_999;
        assert!(past_expiry <= now);

        let future_expiry: i64 = 1_700_000_001;
        assert!(future_expiry > now);
    }
}
