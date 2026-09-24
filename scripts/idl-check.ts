// Checks that every copy of the IDL describes the same interface:
//   - IDL generated from the current program source
//   - committed idl/loot_king.json
//   - on-chain Anchor IDL account (when a cluster is given)
//   - frontend copy (FRONTEND_IDL, default ../frontend/src/idl/loot_king.json)
// Doc comments, metadata.description and item order are ignored.
//
// Usage: [RPC_URL=<url>] pnpm idl:check [-- devnet|mainnet]
import * as anchor from "@coral-xyz/anchor";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  IDL_PATH,
  ROOT,
  connect,
  programId,
  run,
  type Cluster,
} from "./lib/common";

const NAMED_SECTIONS = [
  "instructions",
  "accounts",
  "events",
  "types",
  "errors",
];
const FRONTEND_IDL =
  process.env.FRONTEND_IDL ??
  path.resolve(ROOT, "../frontend/src/idl/loot_king.json");

function stripDocs(value: any): any {
  if (Array.isArray(value)) return value.map(stripDocs);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "docs")
        .map(([key, v]) => [key, stripDocs(v)])
    );
  }
  return value;
}

function normalize(idl: any): any {
  const out = stripDocs(idl);
  if (out.metadata) delete out.metadata.description;
  for (const section of NAMED_SECTIONS) {
    out[section]?.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }
  return out;
}

/** Lists top-level names that differ between two normalized IDLs. */
function diff(a: any, b: any): string[] {
  const problems: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (!NAMED_SECTIONS.includes(key)) {
      problems.push(key);
      continue;
    }
    const byName = (list: any[] = []) =>
      new Map(list.map((item) => [item.name, JSON.stringify(item)]));
    const left = byName(a[key]);
    const right = byName(b[key]);
    for (const name of new Set([...left.keys(), ...right.keys()])) {
      if (left.get(name) !== right.get(name)) problems.push(`${key}.${name}`);
    }
  }
  return problems;
}

function buildFromSource(): any {
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lk-idl-")),
    "idl.json"
  );
  // Anchor 0.32.1 needs Span::local_file (stable since Rust 1.88); force the
  // pinned toolchain so an older default nightly is not picked up.
  execFileSync("anchor", ["idl", "build", "-o", out], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, RUSTUP_TOOLCHAIN: "1.89.0" },
  });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

async function fetchOnChain(cluster: Cluster): Promise<any | null> {
  const provider = new anchor.AnchorProvider(
    connect(cluster),
    new anchor.Wallet(anchor.web3.Keypair.generate()),
    {}
  );
  return anchor.Program.fetchIdl(programId(), provider);
}

run(async () => {
  const cluster = process.argv.slice(2).find((arg) => arg !== "--") as
    | Cluster
    | undefined;
  const reference = normalize(JSON.parse(fs.readFileSync(IDL_PATH, "utf8")));
  const copies: [string, () => Promise<any | null>][] = [
    ["program source", async () => buildFromSource()],
  ];
  if (cluster)
    copies.push([`on-chain (${cluster})`, () => fetchOnChain(cluster)]);
  if (fs.existsSync(FRONTEND_IDL)) {
    copies.push([
      `frontend (${path.relative(ROOT, FRONTEND_IDL)})`,
      async () => JSON.parse(fs.readFileSync(FRONTEND_IDL, "utf8")),
    ]);
  }

  let failed = false;
  console.log(`Reference: ${path.relative(ROOT, IDL_PATH)}`);
  for (const [label, load] of copies) {
    const idl = await load();
    if (!idl) {
      console.log(`✗ ${label}: not found`);
      failed = true;
      continue;
    }
    const problems = diff(reference, normalize(idl));
    if (problems.length) {
      console.log(`✗ ${label}: differs in ${problems.join(", ")}`);
      failed = true;
    } else {
      console.log(`✓ ${label}`);
    }
  }

  if (failed) {
    console.log(
      "\nRegenerate with `pnpm idl:build` and copy to the frontend / upgrade the on-chain IDL."
    );
    process.exit(1);
  }
});
