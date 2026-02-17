import { GameServersConfig } from "./types/GameServersConfig";

export default (): {
  gameServers: GameServersConfig;
} => ({
  gameServers: {
    serverImage:
      process.env.SERVER_IMAGE ||
      "ghcr.io/marcobrunodev/game-server:banana-server",
    namespace: "5stack",
  },
});
