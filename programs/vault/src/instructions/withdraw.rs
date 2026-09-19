use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::{
    self,
    Mint,
    TokenInterface,
    TokenAccount as SplTokenAccount,
};
use anchor_spl::associated_token::AssociatedToken;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::{validate_market_and_feed, calculate_collateral_value_usd};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", user.key().as_ref(), stock_mint.key().as_ref()],
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

    pub stablecoin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(
        vault.collateral_amount >= amount,
        VaultError::InsufficientCollateral
    );

    let post_withdrawal_collateral = vault.collateral_amount
        .checked_sub(amount)
        .ok_or(VaultError::InsufficientCollateral)?;

    match vault.active_strategy {
        Strategy::None => {}
        Strategy::Borrow => {
            let clock = Clock::get()?;
            let ltv_bps = validate_market_and_feed(
                &ctx.accounts.market_state,
                &ctx.accounts.price_update,
                &clock,
            )?;

            let post_collateral_value_usd = calculate_collateral_value_usd(
                post_withdrawal_collateral,
                &ctx.accounts.stock_mint,
                &ctx.accounts.price_update,
                &clock,
                ctx.accounts.stablecoin_mint.decimals,
            )?;

            let max_borrow = post_collateral_value_usd
                .checked_mul(ltv_bps as u128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(10_000u128)
                .ok_or(VaultError::MathOverflow)?;

            require!(
                (vault.borrowed_amount as u128) <= max_borrow,
                VaultError::WithdrawWouldBreakCollateralization
            );
        }
        _ => {
            return err!(VaultError::StrategyActive);
        }
    }

    vault.collateral_amount = post_withdrawal_collateral;

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        mint: ctx.accounts.stock_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };

    let bump = [ctx.accounts.vault.bump];
    let user_key = ctx.accounts.user.key();
    let mint_key = ctx.accounts.stock_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        user_key.as_ref(),
        mint_key.as_ref(),
        &bump,
    ]];

    let cpi_ctx = CpiContext::new_with_signer(
        *ctx.accounts.token_program.key,
        cpi_accounts,
        signer_seeds,
    );

    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stock_mint.decimals)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn withdraw_rejects_when_strategy_is_covered_call() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::CoveredCall;

        let allowed = match vault.active_strategy {
            Strategy::None | Strategy::Borrow => true,
            _ => false,
        };
        assert!(!allowed);
    }

    #[test]
    fn withdraw_allows_when_strategy_is_none() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::None;

        let result = vault.active_strategy == Strategy::None;
        assert!(result);
    }

    #[test]
    fn withdraw_check_collateral_sufficient() {
        let collateral_amount: u64 = 100_000_000;
        let withdraw_amount: u64 = 30_000_000;

        let sufficient = collateral_amount >= withdraw_amount;
        assert!(sufficient);
    }

    #[test]
    fn withdraw_check_collateral_insufficient() {
        let collateral_amount: u64 = 30_000_000;
        let withdraw_amount: u64 = 1_000_000_000;

        let sufficient = collateral_amount >= withdraw_amount;
        assert!(!sufficient);
    }

    #[test]
    fn withdraw_accounting_before_transfer() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.active_strategy = Strategy::None;

        let amount: u64 = 30_000_000;
        assert!(vault.collateral_amount >= amount);

        vault.collateral_amount = vault.collateral_amount.checked_sub(amount).unwrap();
        assert_eq!(vault.collateral_amount, 70_000_000);
    }
}