const { PublicKey } = require("@solana/web3.js");
const { assert } = require("chai");

const VAULT_PROGRAM_ID = new PublicKey("AB41HEqA7PfEbysT5c9DX7A9MNa65GDpG397CoN5cj3z");

const FIXED_USER = new PublicKey("11111111111111111111111111111111");
const FIXED_STOCK_MINT = new PublicKey("So11111111111111111111111111111111111111112");

describe("Vault PDA Derivation", () => {
  it("canonical PDA matches findProgramAddressSync output", () => {
    const [expectedPda, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), FIXED_USER.toBuffer(), FIXED_STOCK_MINT.toBuffer()],
      VAULT_PROGRAM_ID
    );

    const seeds = [Buffer.from("vault"), FIXED_USER.toBuffer(), FIXED_STOCK_MINT.toBuffer()];
    let derivedPda, derivedBump;
    for (let bump = 255; bump >= 0; bump--) {
      try {
        const pda = PublicKey.createProgramAddressSync(
          [...seeds, Buffer.from([bump])],
          VAULT_PROGRAM_ID
        );
        derivedPda = pda;
        derivedBump = bump;
        break;
      } catch (e) {
        continue;
      }
    }

    assert.ok(derivedPda, "should find a valid PDA");
    assert.isTrue(derivedPda.equals(expectedPda), "derived PDA must match canonical");
    assert.equal(derivedBump, expectedBump, "derived bump must match canonical bump");
    assert.equal(derivedBump, expectedBump, "bump should be same as findProgramAddress result");
    assert.isBelow(derivedBump, 256, "bump should fit in u8");
  });

  it("PDA differs when user changes", () => {
    const userA = new PublicKey("11111111111111111111111111111111");
    const userB = new PublicKey("9xQeWvG816bUx9EPa7XW3kq5JmL6uW6H3p8b6kP2r9uV");

    const [pdaA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), userA.toBuffer(), FIXED_STOCK_MINT.toBuffer()],
      VAULT_PROGRAM_ID
    );

    const [pdaB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), userB.toBuffer(), FIXED_STOCK_MINT.toBuffer()],
      VAULT_PROGRAM_ID
    );

    assert.isFalse(pdaA.equals(pdaB), "different users should produce different PDAs");
  });

  it("PDA differs when stock mint changes", () => {
    const mintA = new PublicKey("So11111111111111111111111111111111111111112");
    const mintB = new PublicKey("EPjFWdd5AufqSSqeM2qN1LhqXksL7ai1zS9dABi3nQ1V");

    const [pdaA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), FIXED_USER.toBuffer(), mintA.toBuffer()],
      VAULT_PROGRAM_ID
    );

    const [pdaB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), FIXED_USER.toBuffer(), mintB.toBuffer()],
      VAULT_PROGRAM_ID
    );

    assert.isFalse(pdaA.equals(pdaB), "different mints should produce different PDAs");
  });
});
