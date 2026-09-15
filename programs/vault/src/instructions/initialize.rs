use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize {}

pub fn handle(_ctx: Context<Initialize>) -> Result<()> {
    Ok(())
}
