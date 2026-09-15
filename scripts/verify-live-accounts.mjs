import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import "dotenv/config";

const cluster = process.argv[2];
const localUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8899";
const rpcUrl = cluster === "local" ? localUrl : process.env.MAINNET_RPC_URL;
const xstockMint = process.env.XSTOCK_MINT;
const pythPriceFeedAccount = process.env.PYTH_PRICE_FEED_ACCOUNT;

if (!["mainnet", "local"].includes(cluster)) {
  throw new Error("Usage: node scripts/verify-live-accounts.mjs mainnet|local");
}

if (!rpcUrl) {
  throw new Error(cluster === "local" ? "LOCAL_RPC_URL is required" : "MAINNET_RPC_URL is required");
}

if (!xstockMint) {
  throw new Error("XSTOCK_MINT is required");
}

if (!pythPriceFeedAccount) {
  throw new Error("PYTH_PRICE_FEED_ACCOUNT is required");
}

const connection = new Connection(rpcUrl, "confirmed");
const mintAddress = new PublicKey(xstockMint);
const priceFeedAddress = new PublicKey(pythPriceFeedAccount);
const [mintAccount, priceFeedAccount, slot] = await Promise.all([
  connection.getAccountInfo(mintAddress, "confirmed"),
  connection.getAccountInfo(priceFeedAddress, "confirmed"),
  connection.getSlot("confirmed")
]);

if (!mintAccount) {
  throw new Error(`Missing xStock mint account ${mintAddress.toBase58()}`);
}

if (!priceFeedAccount) {
  throw new Error(`Missing Pyth price feed account ${priceFeedAddress.toBase58()}`);
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
  pyth: {
    account: priceFeedAddress.toBase58(),
    owner: priceFeedAccount.owner.toBase58(),
    executable: priceFeedAccount.executable,
    lamports: priceFeedAccount.lamports,
    dataLength: priceFeedAccount.data.length
  }
};

console.log(JSON.stringify(result, null, 2));
