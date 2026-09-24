import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";

const { Connection, Keypair, PublicKey } = anchor.web3;

export const ROOT = path.resolve(__dirname, "../..");
export const DEFAULT_PROGRAM_ID =
  "6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq";
export const DEFAULT_LEDGER_PUBKEY =
  "H6b59QtgAF7VCx3j73mDqMSxhmkTR7erAL2MbsX17zfm";
export const IDL_PATH = path.join(ROOT, "idl/loot_king.json");

export type Cluster = "devnet" | "mainnet";

export function parseCluster(usage: string): Cluster {
  const cluster = process.argv.slice(2).find((arg) => arg !== "--");
  if (cluster !== "devnet" && cluster !== "mainnet") {
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return cluster;
}

/** Mainnet requires RPC_URL: the public endpoint rejects most traffic. */
export function rpcUrl(cluster: Cluster): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  if (cluster === "devnet") return "https://api.devnet.solana.com";
  throw new Error("RPC_URL is required for mainnet.");
}

export function maskRpc(url: string): string {
  return url.replace(/(api[-_]?key=)[^&]+/i, "$1***");
}

export function expandHome(filePath: string): string {
  return filePath.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
}

export function readKeypair(filePath: string): anchor.web3.Keypair {
  const bytes = JSON.parse(fs.readFileSync(expandHome(filePath), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function readOptionalKeypair(
  filePath: string
): anchor.web3.Keypair | null {
  return fs.existsSync(expandHome(filePath)) ? readKeypair(filePath) : null;
}

export function hotWalletPath(): string {
  return process.env.HOT_WALLET ?? "~/.config/solana/id.json";
}

export function programId(): anchor.web3.PublicKey {
  return new PublicKey(process.env.PROGRAM_ID ?? DEFAULT_PROGRAM_ID);
}

export function ledgerPubkey(): anchor.web3.PublicKey {
  return new PublicKey(process.env.LEDGER_PUBKEY ?? DEFAULT_LEDGER_PUBKEY);
}

export function pdas(id: anchor.web3.PublicKey) {
  const [gameState] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_state")],
    id
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], id);
  return { gameState, vault };
}

export function connect(cluster: Cluster) {
  return new Connection(rpcUrl(cluster), "confirmed");
}

/** Anchor program client. Wallet is only used when sending with `.rpc()`. */
export function loadProgram(
  connection: anchor.web3.Connection,
  id: anchor.web3.PublicKey,
  signer: anchor.web3.Keypair = Keypair.generate()
) {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(signer),
    { commitment: "confirmed" }
  );
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  return new anchor.Program({ ...idl, address: id.toString() }, provider);
}

export async function fetchGameState(
  program: anchor.Program,
  gameState: anchor.web3.PublicKey
): Promise<any | null> {
  const info = await program.provider.connection.getAccountInfo(gameState);
  if (!info) return null;
  return program.coder.accounts.decode("gameState", info.data);
}

export function lamportsToSol(lamports: number | bigint): string {
  return (Number(lamports) / anchor.web3.LAMPORTS_PER_SOL).toFixed(9);
}

export function run(main: () => Promise<void>) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
