import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import BN from "bn.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const IDL_PATH = path.join(__dirname, "..", "target", "idl", "market_state.json");
const WALLET_PATH = path.join(process.env.HOME || "", ".config", "solana", "id.json");

const PROGRAM_ID = new PublicKey("5nHB2F1c5fzXiiUwpQqY6RT6nXfboQfMGiBnMSkCAJc9");

const STOCK_MINT = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const PYTH_AAPL_FEED = new PublicKey("DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy");
const PYTH_TSLA_FEED = new PublicKey("E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ");

const MARKETS = [
  { marketId: "AAPLx", confidenceThreshold: 500, maxFeedAge: 3600, priceFeed: PYTH_AAPL_FEED },
  { marketId: "TSLAx", confidenceThreshold: 500, maxFeedAge: 3600, priceFeed: PYTH_TSLA_FEED },
];

async function main() {
  if (!fs.existsSync(IDL_PATH)) {
    console.error("IDL not found. Run `anchor build -p market_state` first.");
    process.exit(1);
  }
  const idlJson = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));

  const secretKey = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const wallet = new Wallet(keypair);

  const rpcUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idlJson, PROGRAM_ID, provider);

  console.log("Initializing market state accounts...");
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  Authority: ${keypair.publicKey.toBase58()}`);
  console.log("");

  for (const { marketId, confidenceThreshold, maxFeedAge, priceFeed } of MARKETS) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), Buffer.from(marketId)],
      PROGRAM_ID
    );

    const existing = await connection.getAccountInfo(pda);
    if (existing) {
      console.log(`  --> ${marketId}: already initialized at ${pda.toBase58()}`);
      continue;
    }

    try {
      const tx = await program.methods
        .initializeMarket(
          marketId,
          new BN(confidenceThreshold),
          new BN(maxFeedAge)
        )
        .accounts({
          market: pda,
          authority: keypair.publicKey,
          priceFeed,
          stockMint: STOCK_MINT,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  [OK] ${marketId}: initialized at ${pda.toBase58()} (tx: ${tx.slice(0, 8)}...)`);
    } catch (err) {
      console.error(`  [FAIL] ${marketId}: ${err.message || err}`);
    }
  }

  console.log("\nDone! Run `cargo run -p updater` to start the state updater.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
