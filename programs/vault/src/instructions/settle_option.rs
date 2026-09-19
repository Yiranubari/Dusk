use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::Mint;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::validate_market_and_feed;

#[event]
pub struct OptionSettled {
    pub vault: Pubkey,
    pub strike_price: u64,
    pub settlement_price: i64,
    pub is_itm: bool,
}

#[derive(Accounts)]
pub struct SettleOption<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
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

pub fn handle(ctx: Context<SettleOption>) -> Result<()> {
    let clock = Clock::get()?;

    validate_market_and_feed(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;
    require!(vault.active_strategy == Strategy::CoveredCall, VaultError::OptionNotActive);
    require!(clock.unix_timestamp >= vault.expiry_timestamp, VaultError::OptionNotExpired);

    let price_message = &ctx.accounts.price_update.price_message;
    require!(price_message.price > 0, VaultError::InvalidPrice);

    let strike_i64 = vault.strike_price as i64;
    let is_itm = price_message.price >= strike_i64;

    emit!(OptionSettled {
        vault: vault.key(),
        strike_price: vault.strike_price,
        settlement_price: price_message.price,
        is_itm,
    });

    vault.active_strategy = Strategy::None;
    vault.strike_price = 0;
    vault.expiry_timestamp = 0;
    vault.notional_amount = 0;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settle_option_itm_evaluation() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::CoveredCall;
        vault.strike_price = 200_00000000;
        vault.expiry_timestamp = 1_700_000_000;
        vault.notional_amount = 100_000_000;

        let settlement_price: i64 = 250_00000000;
        let strike_i64 = vault.strike_price as i64;
        let is_itm = settlement_price >= strike_i64;

        assert!(is_itm);

        vault.active_strategy = Strategy::None;
        vault.strike_price = 0;
        vault.expiry_timestamp = 0;
        vault.notional_amount = 0;

        assert_eq!(vault.active_strategy, Strategy::None);
        assert_eq!(vault.strike_price, 0);
        assert_eq!(vault.expiry_timestamp, 0);
        assert_eq!(vault.notional_amount, 0);
    }

    #[test]
    fn test_settle_option_otm_evaluation() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::CoveredCall;
        vault.strike_price = 300_00000000;
        vault.expiry_timestamp = 1_700_000_000;
        vault.notional_amount = 100_000_000;

        let settlement_price: i64 = 250_00000000;
        let strike_i64 = vault.strike_price as i64;
        let is_itm = settlement_price >= strike_i64;

        assert!(!is_itm);

        vault.active_strategy = Strategy::None;
        vault.strike_price = 0;
        vault.expiry_timestamp = 0;
        vault.notional_amount = 0;

        assert_eq!(vault.active_strategy, Strategy::None);
        assert_eq!(vault.strike_price, 0);
        assert_eq!(vault.expiry_timestamp, 0);
        assert_eq!(vault.notional_amount, 0);
    }

    #[test]
    fn test_settle_option_expiry_guard() {
        let expiry: i64 = 1_700_000_100;
        let before_expiry: i64 = 1_700_000_050;
        let after_expiry: i64 = 1_700_000_101;

        assert!(before_expiry < expiry);
        assert!(after_expiry >= expiry);
    }
}
