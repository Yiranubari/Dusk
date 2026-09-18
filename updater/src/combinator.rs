use crate::calendar::MarketState;
use crate::staleness::Staleness;

pub fn combine_state(is_calendar_open: bool, staleness: Staleness) -> MarketState {
    if !is_calendar_open {
        return MarketState::Closed;
    }
    match staleness {
        Staleness::Stale => MarketState::Stale,
        Staleness::Fresh => MarketState::Open,
    }
}
