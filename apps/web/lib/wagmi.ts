import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhoodChain, robinhoodTestnet, activeChain } from "./chains";

/** Injected connector only: no WalletConnect project id needed. Active chain first. */
export const wagmiConfig = createConfig({
  chains: activeChain.id === robinhoodChain.id ? [robinhoodChain, robinhoodTestnet] : [robinhoodTestnet, robinhoodChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [robinhoodChain.id]: http(),
    [robinhoodTestnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
