pub mod instructions;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("9BFXopHo6M4VRoLaGwdnt1Ht1Y7EMzY6rW3H8PbKpjoB");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle(ctx)
    }
}
