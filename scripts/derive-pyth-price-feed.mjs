import { PublicKey } from "@solana/web3.js";
import "dotenv/config";

const feedId = process.env.PYTH_AAPL_USD_FEED_ID;
const pushOracleProgramId = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

if (!feedId) {
  throw new Error("PYTH_AAPL_USD_FEED_ID is required");
}

const cleanFeedId = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
const feedIdBuffer = Buffer.from(cleanFeedId, "hex");

if (feedIdBuffer.length !== 32) {
  throw new Error("PYTH_AAPL_USD_FEED_ID must be 32 bytes");
}

const shardBuffer = Buffer.alloc(2);
shardBuffer.writeUint16LE(0, 0);

const [address] = PublicKey.findProgramAddressSync(
  [shardBuffer, feedIdBuffer],
  pushOracleProgramId
);

console.log(address.toBase58());
