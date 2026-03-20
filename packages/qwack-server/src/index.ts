import { app } from "./app";
import { websocket } from "./ws/handler";

const port = parseInt(process.env.QWACK_PORT || "4000");
const host = process.env.QWACK_HOST || "0.0.0.0";

console.log(`🦆 Qwack server starting on ${host}:${port}`);

export default {
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
};
