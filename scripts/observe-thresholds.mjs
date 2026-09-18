import { Connection, PublicKey } from "@solana/web3.js";
import "dotenv/config";

const cluster = process.argv[2] || "mainnet";
const localUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8899";
const rpcUrl = cluster === "local" ? localUrl : process.env.MAINNET_RPC_URL;
const intervalMs = parseInt(process.argv[3] || "5000");
const iterations = parseInt(process.argv[4] || "5");

if (!rpcUrl) {
  throw new Error(cluster === "local" ? "LOCAL_RPC_URL is required" : "MAINNET_RPC_URL is required");
}

const PUSH_ORACLE_PROGRAM_ID = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";

const feeds = {
  AAPL: {
    feedId: process.env.PYTH_AAPL_USD_FEED_ID,
    expectedAccount: process.env.PYTH_PRICE_FEED_ACCOUNT,
  },
  TSLA: {
    feedId: process.env.PYTH_TSLA_USD_FEED_ID,
    expectedAccount: process.env.PYTH_TSLA_PRICE_FEED_ACCOUNT,
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
    throw new Error("Expected at least 134 bytes, got " + data.length);
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
    price,
    actualPrice,
    conf,
    actualConf,
    exponent,
    publishTime,
    prevPublishTime,
    ageSeconds,
    ageDays,
    confPct,
  };
}

async function observeFeed(connection, ticker, feedInfo, iteration) {
  const accountAddress = feedInfo.expectedAccount
    ? new PublicKey(feedInfo.expectedAccount)
    : derivePriceFeedAccount(feedInfo.feedId);

  const accountInfo = await connection.getAccountInfo(accountAddress, "confirmed");
  if (!accountInfo) {
    console.log("[" + iteration + "] " + ticker + ": Account not found");
    return null;
  }

  if (accountInfo.data.length < 134) {
    console.log("[" + iteration + "] " + ticker + ": Insufficient data (len=" + accountInfo.data.length + ")");
    return null;
  }

  const parsed = parsePriceUpdateV2(accountInfo.data);
  return {
    ticker,
    iteration,
    account: accountAddress.toBase58(),
    price: parsed.actualPrice,
    conf: parsed.actualConf,
    exponent: parsed.exponent,
    publishTime: parsed.publishTime,
    publishTimeISO: new Date(parsed.publishTime * 1000).toISOString(),
    ageSeconds: parsed.ageSeconds,
    ageDays: parsed.ageDays,
    confPct: parsed.confPct,
    dataLength: accountInfo.data.length,
    owner: accountInfo.owner.toBase58(),
  };
}

async function main() {
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("Cluster:", cluster);
  console.log("RPC URL:", rpcUrl);
  console.log("Interval:", intervalMs, "ms");
  console.log("Iterations:", iterations);
  console.log("");

  const results = [];

  for (let i = 1; i <= iterations; i++) {
    const iterationResults = [];
    for (const [ticker, feedInfo] of Object.entries(feeds)) {
      try {
        const result = await observeFeed(connection, ticker, feedInfo, i);
        if (result) {
          iterationResults.push(result);
          console.log("[" + i + "] " + ticker + ": price=$" + result.price.toFixed(4) +
            " conf=" + result.conf.toFixed(4) +
            " publish=" + result.publishTime +
            " age=" + result.ageSeconds + "s (" + result.ageDays.toFixed(2) + " days)" +
            " confPct=" + result.confPct.toFixed(4) + "%");
        }
      } catch (error) {
        console.error("[" + i + "] " + ticker + ": Error - " + error.message);
      }
    }
    results.push(...iterationResults);
    if (i < iterations) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(results, null, 2));

  console.log("\n=== Threshold Observations ===");
  for (const ticker of Object.keys(feeds)) {
    const tickerResults = results.filter((r) => r.ticker === ticker);
    if (tickerResults.length === 0) continue;

    const ages = tickerResults.map((r) => r.ageSeconds);
    const confPcts = tickerResults.map((r) => r.confPct);
    const maxAge = Math.max(...ages);
    const minAge = Math.min(...ages);
    const maxConfPct = Math.max(...confPcts);
    const minConfPct = Math.min(...confPcts);

    console.log("\n" + ticker + ":");
    console.log("  Age range: " + minAge + "s (" + (minAge / 86400).toFixed(2) + " days) - " +
      maxAge + "s (" + (maxAge / 86400).toFixed(2) + " days)");
    console.log("  Conf% range: " + minConfPct.toFixed(4) + "% - " + maxConfPct.toFixed(4) + "%");
    console.log("  Recommended max_age_seconds: " + (Math.floor(maxAge) + 3600));
    console.log("  Recommended max_confidence_pct: " + (maxConfPct * 2).toFixed(4) + "%");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
