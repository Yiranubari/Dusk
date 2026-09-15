#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${MAINNET_RPC_URL:?MAINNET_RPC_URL is required}"
: "${XSTOCK_MINT:?XSTOCK_MINT is required}"
: "${PYTH_PRICE_FEED_ACCOUNT:?PYTH_PRICE_FEED_ACCOUNT is required}"

LEDGER_DIR="${SOLANA_TEST_LEDGER:-.anchor/test-ledger}"

exec solana-test-validator \
  --reset \
  --ledger "$LEDGER_DIR" \
  --url "$MAINNET_RPC_URL" \
  --clone "$XSTOCK_MINT" \
  --clone "$PYTH_PRICE_FEED_ACCOUNT" \
  --rpc-port 8899