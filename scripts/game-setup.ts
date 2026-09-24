// One-time game setup after the first deploy, run with the hot wallet:
//   1. initialize the game state (hot wallet becomes game authority),
//   2. point the commission wallet at the Ledger,
//   3. top up the vault rent-exempt reserve,
//   4. propose the Ledger as the new game authority.
// Finish with `pnpm game-authority:accept -- <cluster>` on the Ledger.
// Every step is skipped when already done, so re-running is safe.
//
// Usage: [RPC_URL=<url>] pnpm game:setup -- devnet|mainnet
import * as anchor from "@coral-xyz/anchor";
import {
  connect,
  fetchGameState,
  hotWalletPath,
  ledgerPubkey,
  loadProgram,
  maskRpc,
  parseCluster,
  pdas,
  programId,
  readKeypair,
  rpcUrl,
  run,
} from "./lib/common";

const { SystemProgram, Transaction, sendAndConfirmTransaction } = anchor.web3;

function printState(state: any) {
  console.log(`Authority:          ${state.authority}`);
  console.log(`Pending authority:  ${state.pendingAuthority}`);
  console.log(`Commission wallet:  ${state.commissionWallet}`);
  console.log(`Commission bps:     ${state.commissionBps}`);
}

run(async () => {
  const cluster = parseCluster("pnpm game:setup -- devnet|mainnet");
  const connection = connect(cluster);
  const id = programId();
  const ledger = ledgerPubkey();
  const hotWallet = readKeypair(hotWalletPath());
  const program = loadProgram(connection, id, hotWallet);
  const { gameState, vault } = pdas(id);

  console.log(`Cluster:            ${cluster}`);
  console.log(`RPC:                ${maskRpc(rpcUrl(cluster))}`);
  console.log(`Program ID:         ${id}`);
  console.log(`Game state:         ${gameState}`);
  console.log(`Vault:              ${vault}`);
  console.log(`Hot wallet:         ${hotWallet.publicKey}`);
  console.log(`Ledger pubkey:      ${ledger}`);

  let state = await fetchGameState(program, gameState);

  if (!state) {
    console.log("Initializing game state...");
    const txid = await program.methods
      .initialize(ledger)
      .accounts({
        gameState,
        vault,
        authority: hotWallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`Initialize tx:      ${txid}`);
    state = await fetchGameState(program, gameState);
  }
  if (!state) throw new Error("Game state was not created.");

  const isHotAuthority = state.authority.equals(hotWallet.publicKey);

  if (!state.commissionWallet.equals(ledger)) {
    if (!isHotAuthority) {
      console.log(
        "Commission wallet differs, but hot wallet is not the authority; skipping."
      );
    } else {
      console.log("Updating commission wallet...");
      const txid = await program.methods
        .updateCommissionWallet(ledger)
        .accounts({ gameState, authority: hotWallet.publicKey } as any)
        .rpc();
      console.log(`Commission tx:      ${txid}`);
    }
  }

  const rentMin = await connection.getMinimumBalanceForRentExemption(0);
  const vaultBalance = await connection.getBalance(vault);
  if (!state.isActive && !state.hasPendingPrize && vaultBalance < rentMin) {
    console.log("Funding vault rent-exempt reserve...");
    const txid = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: hotWallet.publicKey,
          toPubkey: vault,
          lamports: rentMin * 2 - vaultBalance,
        })
      ),
      [hotWallet]
    );
    console.log(`Vault fund tx:      ${txid}`);
  }

  if (!isHotAuthority) {
    console.log(
      "Hot wallet is not the game authority; skipping transfer proposal."
    );
  } else if (!state.pendingAuthority.equals(ledger)) {
    console.log("Proposing Ledger game authority...");
    const txid = await program.methods
      .transferAuthority(ledger)
      .accounts({ gameState, authority: hotWallet.publicKey } as any)
      .rpc();
    console.log(`Transfer tx:        ${txid}`);
  }

  state = await fetchGameState(program, gameState);
  console.log("\nFinal state:");
  printState(state);
});
