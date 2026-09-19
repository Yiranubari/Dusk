use anchor_lang::prelude::*;
use crate::state::Vault;
use anchor_spl::token_interface::{
    self,
    Mint,
    TokenInterface,
    TokenAccount as SplTokenAccount,
};
use anchor_spl::associated_token::AssociatedToken;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"vault", user.key().as_ref(), stock_mint.key().as_ref()],
        bump,
        space = Vault::LEN,
    )]
    pub vault: Account<'info, Vault>,

    pub stock_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, SplTokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = stock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, SplTokenAccount>,

    #[account(
        constraint = market_state.stock_mint == stock_mint.key() @ VaultError::InvalidMarketState
    )]
    pub market_state: Account<'info, market_state::Market>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    if vault.collateral_amount == 0 {
        vault.owner = ctx.accounts.user.key();
        vault.stock_mint = ctx.accounts.stock_mint.key();
        vault.market_state = ctx.accounts.market_state.key();
        vault.bump = ctx.bumps.vault;
    } else {
        require!(
            vault.market_state == ctx.accounts.market_state.key(),
            VaultError::InvalidMarketState
        );
    }

    vault.collateral_amount = vault.collateral_amount
        .checked_add(amount)
        .ok_or(VaultError::CollateralOverflow)?;

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.stock_mint.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(*ctx.accounts.token_program.key, cpi_accounts);

    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stock_mint.decimals)?;

    Ok(())
}

pub use crate::errors::VaultError;
pub use VaultError as DepositError;