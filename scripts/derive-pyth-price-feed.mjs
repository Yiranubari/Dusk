import { PublicKey } from "@solana/web3.js";
import "dotenv/config";

const pushOracleProgramId = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const shardBuffer = Buffer.alloc(2);
shardBuffer.writeUint16LE(0, 0);

function derivePriceFeedAddress(feedIdHex) {
  const cleanFeedId = feedIdHex.startsWith("0x") ? feedIdHex.slice(2) : feedIdHex;
  const feedIdBuffer = Buffer.from(cleanFeedId, "hex");
  if (feedIdBuffer.length !== 32) {
    throw new Error("Feed ID must be 32 bytes (64 hex chars)");
  }
  const [address] = PublicKey.findProgramAddressSync(
    [shardBuffer, feedIdBuffer],
    pushOracleProgramId
  );
  return address;
}

const tickers = ["AAPL", "TSLA"];
const result = {};

for (const ticker of tickers) {
  const envKey = `PYTH_${ticker}_USD_FEED_ID`;
  const feedId = process.env[envKey];
  if (!feedId) {
    throw new Error(`${envKey} is required`);
  }
  const address = derivePriceFeedAddress(feedId);
  result[ticker] = {
    feed_id: feedId,
    account: address.toBase58(),
  };
  console.log(`${ticker}: ${address.toBase58()}`);
}

export { derivePriceFeedAddress, result as priceFeeds };
