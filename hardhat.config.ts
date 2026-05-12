import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

// HairyEngine smart-contract dev environment.
//
// Networks:
//   • hardhat       — in-process EVM for unit tests + local deploys
//   • localhost     — `npx hardhat node` running on :8545
//   • pulsechain    — mainnet, chain id 369. Reads PRIVATE_KEY from .env.
//   • pulsechainTestnet — testnet v4, chain id 943
//
// Never commit a real PRIVATE_KEY. .env is gitignored; the env var is read
// at runtime so CI / coworkers can deploy with their own key.
//
// Commands:
//   npx hardhat compile
//   npx hardhat test
//   npx hardhat node                          # local devnet
//   npx hardhat run scripts/deploy.ts --network localhost
//   npx hardhat run scripts/deploy.ts --network pulsechain

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';
const ACCOUNTS = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: './contracts',
    tests: './test/contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {},
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    pulsechain: {
      url: 'https://rpc.pulsechain.com',
      chainId: 369,
      accounts: ACCOUNTS,
    },
    pulsechainTestnet: {
      url: 'https://rpc.v4.testnet.pulsechain.com',
      chainId: 943,
      accounts: ACCOUNTS,
    },
  },
};

export default config;
