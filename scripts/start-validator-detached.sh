#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${MAINNET_RPC_URL:?MAINNET_RPC_URL is required}"
: "${XSTOCK_MINT:?XSTOCK_MINT is required}"
: "${PYTH_AAPL_USD_FEED_ID:?PYTH_AAPL_USD_FEED_ID is required}"
: "${PYTH_TSLA_USD_FEED_ID:?PYTH_TSLA_USD_FEED_ID is required}"

PYTH_PRICE_FEED_ACCOUNT=$(node scripts/derive-pyth-price-feed.mjs 2>/dev/null | grep "^AAPL:" | awk '{print $2}')
PYTH_TSLA_PRICE_FEED_ACCOUNT=$(node scripts/derive-pyth-price-feed.mjs 2>/dev/null | grep "^TSLA:" | awk '{print $2}')

if [ -z "$PYTH_PRICE_FEED_ACCOUNT" ] || [ -z "$PYTH_TSLA_PRICE_FEED_ACCOUNT" ]; then
  echo "ERROR: Could not derive Pyth price feed accounts"
  exit 1
fi

echo "AAPL feed account: $PYTH_PRICE_FEED_ACCOUNT"
echo "TSLA feed account: $PYTH_TSLA_PRICE_FEED_ACCOUNT"

LEDGER_DIR="${SOLANA_TEST_LEDGER:-.anchor/test-ledger}"

exec solana-test-validator \
  --reset \
  --ledger "$LEDGER_DIR" \
  --url "$MAINNET_RPC_URL" \
  --clone "$XSTOCK_MINT" \
  --clone "$PYTH_PRICE_FEED_ACCOUNT" \
  --clone "$PYTH_TSLA_PRICE_FEED_ACCOUNT" \
  --rpc-port 8899