use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::{
    self,
    Mint,
    TokenInterface,
    TokenAccount as SplTokenAccount,
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::validate_market_and_feed_staleness;
use super::claim_stream::calculate_vested_amount;

#[derive(Accounts)]
pub struct RevokeStream<'info> {
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
        constraint = market_state.key() == vault.market_state @ VaultError::InvalidMarketState
    )]
    pub market_state: Box<Account<'info, market_state::Market>>,

    #[account(
        constraint = price_update.key() == market_state.price_feed @ VaultError::InvalidPriceFeed
    )]
    pub price_update: Box<Account<'info, PriceUpdateV2>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = vault.stream_recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle(ctx: Context<RevokeStream>) -> Result<()> {
    let clock = Clock::get()?;

    validate_market_and_feed_staleness(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;
    require!(vault.active_strategy == Strategy::Streaming, VaultError::StreamNotActive);
    require!(vault.stream_revocable, VaultError::StreamNotRevocable);

    let vested = calculate_vested_amount(
        vault.stream_total_amount,
        vault.stream_start,
        vault.stream_end,
        vault.stream_cliff,
        clock.unix_timestamp,
    )?;

    let payout = vested
        .checked_sub(vault.stream_released_amount)
        .ok_or(VaultError::MathOverflow)?;

    if payout > 0 {
        vault.collateral_amount = vault.collateral_amount
            .checked_sub(payout)
            .ok_or(VaultError::MathOverflow)?;
    }

    vault.active_strategy = Strategy::None;
    vault.stream_recipient = Pubkey::default();
    vault.stream_start = 0;
    vault.stream_end = 0;
    vault.stream_cliff = 0;
    vault.stream_total_amount = 0;
    vault.stream_released_amount = 0;
    vault.stream_revocable = false;

    if payout > 0 {
        let cpi_accounts = token_interface::TransferChecked {
            from: ctx.accounts.vault_token_account.to_account_info(),
            mint: ctx.accounts.stock_mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };

        let bump = [ctx.accounts.vault.bump];
        let owner_key = ctx.accounts.vault.owner;
        let mint_key = ctx.accounts.stock_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            owner_key.as_ref(),
            mint_key.as_ref(),
            &bump,
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            *ctx.accounts.token_program.key,
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, payout, ctx.accounts.stock_mint.decimals)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_revoke_stream_success() {
        let mut vault = Vault::default();
        vault.collateral_amount = 1_000_000;
        vault.active_strategy = Strategy::Streaming;
        vault.stream_total_amount = 500_000;
        vault.stream_released_amount = 100_000;
        vault.stream_revocable = true;

        let vested = 300_000u64;
        let payout = vested - vault.stream_released_amount;
        assert_eq!(payout, 200_000);

        vault.collateral_amount = vault.collateral_amount.checked_sub(payout).unwrap();
        vault.active_strategy = Strategy::None;
        vault.stream_total_amount = 0;
        vault.stream_released_amount = 0;
        vault.stream_revocable = false;

        assert_eq!(vault.collateral_amount, 800_000);
        assert_eq!(vault.active_strategy, Strategy::None);
        assert_eq!(vault.stream_total_amount, 0);
    }

    #[test]
    fn test_revoke_stream_non_revocable() {
        let mut vault = Vault::default();
        vault.active_strategy = Strategy::Streaming;
        vault.stream_revocable = false;

        assert!(!vault.stream_revocable);
    }
}
