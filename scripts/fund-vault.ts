// Tops the vault PDA up to twice the rent-exempt minimum on top of what it
// owes (the margin covers future rent parameter changes).
// Without this reserve, any stray lamports sent to the vault make the next
// payout fail with "insufficient funds for rent" (see tests/loot-king.ts).
// Any wallet can fund the vault; the hot wallet pays by default.
//
// Usage: [RPC_URL=<url>] pnpm fund-vault -- devnet|mainnet [--execute]
import * as anchor from "@coral-xyz/anchor";
import {
  connect,
  fetchGameState,
  hotWalletPath,
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

run(async () => {
  const cluster = parseCluster("pnpm fund-vault -- devnet|mainnet [--execute]");
  const execute = process.argv.includes("--execute");
  const connection = connect(cluster);
  const id = programId();
  const { gameState, vault } = pdas(id);
  const program = loadProgram(connection, id);
  const payer = readKeypair(hotWalletPath());

  const state = await fetchGameState(program, gameState);
  if (!state) throw new Error("Game state is not initialized.");

  const owed =
    BigInt(state.bank.toString()) +
    (state.hasPendingPrize
      ? BigInt(state.pendingPrize.toString()) +
        BigInt(state.pendingCommission.toString())
      : 0n);
  const balance = BigInt(await connection.getBalance(vault));
  const rentMin = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  const reserve = balance - owed;
  const target = rentMin * 2n;
  const topUp = target - reserve;

  console.log(`Cluster:        ${cluster}`);
  console.log(`RPC:            ${maskRpc(rpcUrl(cluster))}`);
  console.log(`Vault:          ${vault}`);
  console.log(`Balance:        ${balance} lamports`);
  console.log(`Owed to rounds: ${owed} lamports`);
  console.log(
    `Reserve:        ${reserve} lamports (rent-exempt min ${rentMin}, target ${target})`
  );
  console.log(`Payer:          ${payer.publicKey}`);

  if (reserve >= rentMin) {
    console.log("Vault reserve is already sufficient.");
    return;
  }

  console.log(`Top-up:         ${topUp} lamports`);
  if (!execute) {
    console.log(`Dry run. Re-run with --execute to send.`);
    return;
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: vault,
      lamports: topUp,
    })
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`Signature:      ${signature}`);
  console.log(`Vault balance:  ${await connection.getBalance(vault)} lamports`);
});
