import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import hre from "hardhat";

/**
 * Deploys FasalXEscrow and writes the address into the repo-root .env.
 *
 * The API reads ESCROW_CONTRACT_ADDRESS from there, so deploying and wiring up
 * are one step rather than a copy-paste the demo can get wrong.
 *
 *   pnpm --filter @fasalx/blockchain deploy:local   # a running `hardhat node`
 *   pnpm --filter @fasalx/blockchain deploy:amoy    # Polygon Amoy
 */

const ENV_PATH = resolve(__dirname, "..", "..", ".env");

/** Rewrites one key in .env, appending it when absent. */
function upsertEnv(key: string, value: string): void {
  let contents = "";
  try {
    contents = readFileSync(ENV_PATH, "utf8");
  } catch {
    contents = "";
  }

  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(contents)) {
    contents = contents.replace(pattern, line);
  } else {
    contents = `${contents.replace(/\n*$/, "\n")}${line}\n`;
  }

  writeFileSync(ENV_PATH, contents);
}

async function main(): Promise<void> {
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) {
    throw new Error(
      "No account available. For Amoy set DEPLOYER_PRIVATE_KEY in .env; " +
        "for local development start `pnpm chain` first.",
    );
  }

  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({ address: deployer.account.address });

  console.log(`network    ${hre.network.name} (chain ${chainId})`);
  console.log(`deployer   ${deployer.account.address}`);
  console.log(`balance    ${Number(balance) / 1e18} native`);

  if (balance === 0n) {
    throw new Error(
      "Deployer has no balance. On Amoy, get test POL from the faucet first.",
    );
  }

  // The deployer becomes the owner: the platform is what creates deals and
  // attests logistics events on-chain.
  const escrow = await hre.viem.deployContract("FasalXEscrow", [deployer.account.address]);
  console.log(`\ndeployed   FasalXEscrow at ${escrow.address}`);

  upsertEnv("ESCROW_CONTRACT_ADDRESS", escrow.address);
  upsertEnv("CHAIN_ID", String(chainId));
  console.log(`wrote      ESCROW_CONTRACT_ADDRESS and CHAIN_ID to .env`);

  const owner = await escrow.read.owner();
  const count = await escrow.read.dealCount();
  console.log(`verified   owner ${owner}, ${count} deals\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
