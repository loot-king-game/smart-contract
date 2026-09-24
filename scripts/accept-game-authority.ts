// Accepts a pending game authority transfer with the Ledger.
// The hot wallet pays the fee; the Ledger signs as the new authority.
//
// Usage: [RPC_URL=<url>] pnpm game-authority:accept -- devnet|mainnet
import * as anchor from "@coral-xyz/anchor";
import {
  connect,
  fetchGameState,
  hotWalletPath,
  loadProgram,
  parseCluster,
  pdas,
  programId,
  readKeypair,
  run,
} from "./lib/common";
import { ledgerAddress, signAndSendWithLedger } from "./lib/ledger";

const { Transaction } = anchor.web3;

run(async () => {
  const cluster = parseCluster("pnpm game-authority:accept -- devnet|mainnet");
  const connection = connect(cluster);
  const id = programId();
  const hotWallet = readKeypair(hotWalletPath());
  const program = loadProgram(connection, id, hotWallet);
  const { gameState } = pdas(id);
  const ledger = await ledgerAddress();

  const before = await fetchGameState(program, gameState);
  if (!before) throw new Error("Game state is not initialized.");
  console.log(`Current authority:  ${before.authority}`);
  console.log(`Pending authority:  ${before.pendingAuthority}`);
  console.log(`Ledger:             ${ledger}`);

  if (!before.pendingAuthority.equals(ledger)) {
    throw new Error("Pending authority does not match the Ledger public key.");
  }

  const instruction = await program.methods
    .acceptAuthority()
    .accounts({ gameState, newAuthority: ledger } as any)
    .instruction();
  const tx = new Transaction({
    feePayer: hotWallet.publicKey,
    ...(await connection.getLatestBlockhash("confirmed")),
  }).add(instruction);

  await signAndSendWithLedger(connection, [tx], hotWallet);

  const after = await fetchGameState(program, gameState);
  console.log(`Authority after:    ${after.authority}`);
  console.log(`Pending after:      ${after.pendingAuthority}`);
});
