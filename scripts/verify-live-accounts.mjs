import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import "dotenv/config";

const cluster = process.argv[2];
const localUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8899";
const rpcUrl = cluster === "local" ? localUrl : process.env.MAINNET_RPC_URL;
const xstockMint = process.env.XSTOCK_MINT;

if (!["mainnet", "local"].includes(cluster)) {
  throw new Error("Usage: node scripts/verify-live-accounts.mjs mainnet|local");
}

if (!rpcUrl) {
  throw new Error(cluster === "local" ? "LOCAL_RPC_URL is required" : "MAINNET_RPC_URL is required");
}

if (!xstockMint) {
  throw new Error("XSTOCK_MINT is required");
}

const PUSH_ORACLE_PROGRAM_ID = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";

const feeds = {
  AAPL: {
    feedId: process.env.PYTH_AAPL_USD_FEED_ID,
    expectedAccount: process.env.PYTH_PRICE_FEED_ACCOUNT,
    ticker: "AAPLx",
  },
  TSLA: {
    feedId: process.env.PYTH_TSLA_USD_FEED_ID,
    expectedAccount: null,
    ticker: "TSLAx",
  },
};

function derivePriceFeedAccount(feedIdHex) {
  const cleanFeedId = feedIdHex.startsWith("0x") ? feedIdHex.slice(2) : feedIdHex;
  const feedIdBuffer = Buffer.from(cleanFeedId, "hex");
  const shardBuffer = Buffer.alloc(2);
  shardBuffer.writeUint16LE(0, 0);
  const [address] = PublicKey.findProgramAddressSync(
    [shardBuffer, feedIdBuffer],
    new PublicKey(PUSH_ORACLE_PROGRAM_ID)
  );
  return address;
}

function readI64LE(buf, offset) {
  let bits = 0n;
  for (let i = 0; i < 8; i++) {
    bits |= BigInt(buf[offset + i]) << (BigInt(i) * 8n);
  }
  if (bits & (1n << 63n)) {
    bits = bits - (1n << 64n);
  }
  return Number(bits);
}

function readU64LE(buf, offset) {
  let bits = 0n;
  for (let i = 0; i < 8; i++) {
    bits |= BigInt(buf[offset + i]) << (BigInt(i) * 8n);
  }
  return Number(bits);
}

function readI32LE(buf, offset) {
  let bits = 0n;
  for (let i = 0; i < 4; i++) {
    bits |= BigInt(buf[offset + i]) << (BigInt(i) * 8n);
  }
  if (bits & (1n << 31n)) {
    bits = bits - (1n << 32n);
  }
  return Number(bits);
}

function parsePriceUpdateV2(data) {
  if (data.length < 134) {
    throw new Error(`Expected at least 134 bytes, got ${data.length}`);
  }
  const offset = 8 + 32 + 1;
  const feedId = data.subarray(offset, offset + 32);
  const price = readI64LE(data, offset + 32);
  const conf = readU64LE(data, offset + 40);
  const exponent = readI32LE(data, offset + 48);
  const publishTime = readI64LE(data, offset + 52);
  const prevPublishTime = readI64LE(data, offset + 60);
  const exponentFactor = Math.pow(10, Math.abs(exponent));
  const actualPrice = price / exponentFactor;
  const actualConf = conf / exponentFactor;
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - publishTime;
  const ageDays = ageSeconds / 86400;
  const confPct = (actualConf / actualPrice) * 100;
  return {
    feedId: "0x" + Buffer.from(feedId).toString("hex"),
    price, actualPrice, conf, actualConf, exponent,
    publishTime, prevPublishTime, ageSeconds, ageDays, confPct,
  };
}

async function verifyFeed(connection, ticker, feedInfo, slot) {
  let accountAddress;
  let feedId;
  if (feedInfo.expectedAccount) {
    accountAddress = new PublicKey(feedInfo.expectedAccount);
    feedId = feedInfo.feedId;
  } else {
    feedId = feedInfo.feedId;
    if (!feedId) throw new Error(`${ticker} feed ID is required`);
    accountAddress = derivePriceFeedAccount(feedId);
  }
  if (!feedId) throw new Error(`${ticker} feed ID is required`);
  console.log(`\n=== Verifying ${ticker} ===`);
  console.log(`Feed ID: ${feedId}`);
  console.log(`Expected Account: ${accountAddress.toBase58()}`);
  const accountInfo = await connection.getAccountInfo(accountAddress, "confirmed");
  if (!accountInfo) {
    throw new Error(`Missing Pyth price feed account ${accountAddress.toBase58()}`);
  }
  console.log(`Account Owner: ${accountInfo.owner.toBase58()}`);
  console.log(`Data Length: ${accountInfo.data.length}`);
  const data = accountInfo.data;
  const actualDisc = Buffer.from(data.slice(0, 4)).toString("hex");
  console.log(`Discriminator: ${actualDisc} (expected: 22f123639d7ef4cd)`);
  if (data.length >= 134) {
    const parsed = parsePriceUpdateV2(data);
    console.log("\n--- PriceUpdateV2 Parsed ---");
    console.log(`  Feed ID:      ${parsed.feedId}`);
    console.log(`  Price:        ${parsed.price}`);
    console.log(`  Actual Price: $${parsed.actualPrice.toFixed(4)}`);
    console.log(`  Conf:         ${parsed.conf}`);
    console.log(`  Actual Conf:  ${parsed.actualConf.toFixed(4)}`);
    console.log(`  Exponent:     ${parsed.exponent}`);
    console.log(`  Publish Time: ${parsed.publishTime} (${new Date(parsed.publishTime * 1000).toISOString()})`);
    console.log(`  Prev Pub Time: ${parsed.prevPublishTime} (${new Date(parsed.prevPublishTime * 1000).toISOString()})`);
    console.log(`  Age:          ${parsed.ageSeconds}s (${parsed.ageDays.toFixed(2)} days)`);
    console.log(`  Conf/Price:   ${parsed.confPct.toFixed(4)}%`);
  }
  return accountAddress;
}

async function main() {
  const connection = new Connection(rpcUrl, "confirmed");
  const mintAddress = new PublicKey(xstockMint);
  const slot = await connection.getSlot("confirmed");
  console.log("Cluster:", cluster);
  console.log("RPC URL:", rpcUrl);
  console.log("Slot:", slot);
  console.log("xStock Mint:", mintAddress.toBase58());

  const [mintAccount] = await Promise.all([
    connection.getAccountInfo(mintAddress, "confirmed"),
  ]);
  if (!mintAccount) {
    throw new Error(`Missing xStock mint account ${mintAddress.toBase58()}`);
  }
  const mint = await getMint(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);

  const result = {
    cluster,
    slot,
    xstock: {
      mint: mintAddress.toBase58(),
      owner: mintAccount.owner.toBase58(),
      token2022: mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID),
      decimals: mint.decimals,
      supply: mint.supply.toString(),
      dataLength: mintAccount.data.length
    },
    pythFeeds: {}
  };

  for (const [ticker, feedInfo] of Object.entries(feeds)) {
    try {
      const accountAddress = await verifyFeed(connection, ticker, feedInfo, slot);
      const accountInfo = await connection.getAccountInfo(accountAddress, "confirmed");
      result.pythFeeds[ticker] = {
        account: accountAddress.toBase58(),
        feedId: feedInfo.feedId,
        owner: accountInfo?.owner.toBase58() || "unknown",
        lamports: accountInfo?.lamports || 0,
        dataLength: accountInfo?.data.length || 0,
        executable: accountInfo?.executable || false
      };
    } catch (error) {
      console.error(`\nError verifying ${ticker}:`, error.message);
      result.pythFeeds[ticker] = { error: error.message };
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
