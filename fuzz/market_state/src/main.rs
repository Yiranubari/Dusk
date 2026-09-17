use crucible_fuzzer::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_pubkey::Pubkey;
use anchor_lang::system_program;
use std::rc::Rc;

crucible_idl_gen::declare_fuzz_program!("idls/market_state.json");

use market_state::instruction;
use market_state::accounts;
use market_state::state::Market;
use market_state::types::MarketState;

const MARKET_IDS: [&str; 3] = ["BTC-USD", "ETH-USD", "SOL-USD"];
const MAX_MARKET_ID_LEN: usize = 16;
const PYTH_MAGIC: u32 = 0x12037420;
const FAR_FUTURE: i64 = i64::MAX / 4;

fn build_pyth_account(conf: u64, timestamp: i64) -> Vec<u8> {
    let mut d = Vec::with_capacity(112);
    d.extend_from_slice(&PYTH_MAGIC.to_le_bytes());
    d.extend_from_slice(&2u32.to_le_bytes());
    d.extend_from_slice(&3u32.to_le_bytes());
    d.extend_from_slice(&112u32.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes());
    d.extend_from_slice(&timestamp.to_le_bytes());
    d.extend_from_slice(&timestamp.to_le_bytes());
    d.extend_from_slice(&100i64.to_le_bytes());
    d.extend_from_slice(&100i64.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&100i64.to_le_bytes());
    d.extend_from_slice(&100i64.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes());
    d
}

#[derive(Clone)]
struct MarketStateFixture {
    ctx: TestContext,
    program_id: Pubkey,
    authority: Rc<Keypair>,
    attacker: Rc<Keypair>,
    markets: Vec<Pubkey>,
    junk_feeds: Vec<Pubkey>,
    pyth_feeds: Vec<Pubkey>,
    created_at: Vec<i64>,
    confidence_threshold: Vec<u64>,
    max_feed_age: Vec<i64>,
}

impl MarketStateFixture {
    fn decode_state(state_idx: u8) -> MarketState {
        match state_idx % 3 {
            0 => MarketState::Open,
            1 => MarketState::Closed,
            _ => MarketState::Stale,
        }
    }
}

#[fuzz_fixture]
impl MarketStateFixture {
    pub fn setup() -> Self {
        let mut ctx = TestContext::new();
        let program_id = market_state::ID;

        ctx.add_program(&program_id, "../../target/deploy/market_state.so")
            .unwrap();

        let authority = Rc::new(Keypair::new());
        let attacker = Rc::new(Keypair::new());
        for kp in [&authority, &attacker] {
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(100_000_000_000)
                .owner(system_program::ID)
                .create()
                .unwrap();
        }

        let junk_feeds = [1usize, 3, 4, 8, 12, 64]
            .into_iter()
            .map(|size| {
                let kp = Keypair::new();
                ctx.create_account()
                    .pubkey(kp.pubkey())
                    .lamports(10_000_000)
                    .owner(program_id)
                    .size(size)
                    .create()
                    .unwrap();
                kp.pubkey()
            })
            .collect::<Vec<_>>();

        let pyth_feeds = [
            (0u64, FAR_FUTURE),
            (0u64, -FAR_FUTURE),
            (u64::MAX, FAR_FUTURE),
        ]
        .into_iter()
        .map(|(conf, timestamp)| {
            let kp = Keypair::new();
            ctx.create_account()
                .pubkey(kp.pubkey())
                .lamports(10_000_000)
                .owner(program_id)
                .data(&build_pyth_account(conf, timestamp))
                .create()
                .unwrap();
            kp.pubkey()
        })
        .collect::<Vec<_>>();

        let mut markets = Vec::new();
        let mut created_at = Vec::new();
        let mut confidence_threshold = Vec::new();
        let mut max_feed_age = Vec::new();

        for (i, market_id) in MARKET_IDS.iter().enumerate() {
            let (pda, _) =
                Pubkey::find_program_address(&[b"market", market_id.as_bytes()], &program_id);

            ctx.program(program_id)
                .call(instruction::InitializeMarket {
                    market_id: market_id.to_string(),
                    confidence_threshold: 1_000 * (i as u64 + 1),
                    max_feed_age: 3_600,
                })
                .accounts(accounts::InitializeMarket {
                    market: pda,
                    authority: authority.pubkey(),
                    price_feed: None,
                })
                .signers(&[&*authority])
                .send()
                .expect("initialize_market failed in setup");

            let market: Market = ctx
                .read_anchor_account(&pda)
                .expect("market unreadable after init");

            markets.push(pda);
            created_at.push(market.created_at);
            confidence_threshold.push(market.confidence_threshold);
            max_feed_age.push(market.max_feed_age);
        }

        Self {
            ctx,
            program_id,
            authority,
            attacker,
            markets,
            junk_feeds,
            pyth_feeds,
            created_at,
            confidence_threshold,
            max_feed_age,
        }
    }

    pub fn action_update_state(
        &mut self,
        #[range(0..3)] market_idx: usize,
        #[range(0..3)] state_idx: u8,
    ) {
        let _ = self
            .ctx
            .program(self.program_id)
            .call(instruction::UpdateMarketState {
                new_state: Self::decode_state(state_idx),
            })
            .accounts(accounts::UpdateMarketState {
                market: self.markets[market_idx],
                authority: self.authority.pubkey(),
                price_feed: None,
            })
            .signers(&[&*self.authority])
            .send();
    }

    pub fn action_update_state_unauthorized(
        &mut self,
        #[range(0..3)] market_idx: usize,
        #[range(0..3)] state_idx: u8,
    ) {
        let _ = self
            .ctx
            .program(self.program_id)
            .call(instruction::UpdateMarketState {
                new_state: Self::decode_state(state_idx),
            })
            .accounts(accounts::UpdateMarketState {
                market: self.markets[market_idx],
                authority: self.attacker.pubkey(),
                price_feed: None,
            })
            .signers(&[&*self.attacker])
            .send();
    }

    pub fn action_update_junk_feed(
        &mut self,
        #[range(0..3)] market_idx: usize,
        #[range(0..3)] state_idx: u8,
        #[range(0..6)] feed_idx: usize,
    ) {
        let _ = self
            .ctx
            .program(self.program_id)
            .call(instruction::UpdateMarketState {
                new_state: Self::decode_state(state_idx),
            })
            .accounts(accounts::UpdateMarketState {
                market: self.markets[market_idx],
                authority: self.authority.pubkey(),
                price_feed: Some(self.junk_feeds[feed_idx]),
            })
            .signers(&[&*self.authority])
            .send();
    }

    pub fn action_update_pyth_feed(
        &mut self,
        #[range(0..3)] market_idx: usize,
        #[range(0..3)] state_idx: u8,
        #[range(0..3)] feed_idx: usize,
    ) {
        let market_key = self.markets[market_idx];
        let outcome = self
            .ctx
            .program(self.program_id)
            .call(instruction::UpdateMarketState {
                new_state: Self::decode_state(state_idx),
            })
            .accounts(accounts::UpdateMarketState {
                market: market_key,
                authority: self.authority.pubkey(),
                price_feed: Some(self.pyth_feeds[feed_idx]),
            })
            .signers(&[&*self.authority])
            .send();

        if feed_idx != 0 {
            if let Ok(o) = outcome {
                if o.is_success() {
                    if let Ok(market) = self.ctx.read_anchor_account::<Market>(&market_key) {
                        fuzz_assert!(matches!(market.state, MarketState::Stale));
                    }
                }
            }
        }
    }

    pub fn action_advance_time(&mut self, #[range(1..50_000)] slots: u64) {
        self.ctx.warp_to_slot(self.ctx.slot() + slots);
    }
}

#[invariant_test]
fn invariant_test(fixture: &mut MarketStateFixture) {
    for (i, pda) in fixture.markets.iter().enumerate() {
        if !fixture.ctx.account_has_data(pda, 8) {
            continue;
        }
        let market: Market = match fixture.ctx.read_anchor_account(pda) {
            Ok(market) => market,
            Err(_) => continue,
        };

        fuzz_assert_eq!(market.authority, fixture.authority.pubkey());
        fuzz_assert_eq!(market.created_at, fixture.created_at[i]);
        fuzz_assert_eq!(market.confidence_threshold, fixture.confidence_threshold[i]);
        fuzz_assert_eq!(market.max_feed_age, fixture.max_feed_age[i]);

        fuzz_assert_le!(market.market_id.len(), MAX_MARKET_ID_LEN);

        let (expected, _) = Pubkey::find_program_address(
            &[b"market", market.market_id.as_bytes()],
            &fixture.program_id,
        );
        fuzz_assert_eq!(*pda, expected);

        fuzz_assert_ge!(market.last_update_ts, market.created_at);
    }
}
