import { config as loadEnv } from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";

loadEnv({ path: "../.env", quiet: true });

const RPC_URL = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // In-process chain used by `hardhat test`.
    hardhat: {
      chainId: 31337,
    },
    // The standalone `hardhat node`, which the API talks to in development.
    localhost: {
      url: RPC_URL,
      chainId: 31337,
    },
    // Kept configured so moving to Polygon is a network flag, not a rewrite.
    // Needs DEPLOYER_PRIVATE_KEY and test POL in the account.
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
