import { Container } from "@cloudflare/containers";

export class MediaContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";

  // The server is PID 1 in its container and has no SIGTERM handler, so the
  // default SIGTERM stop is ignored and the container keeps running (and billing).
  async stop() {
    await this.destroy();
  }
}
