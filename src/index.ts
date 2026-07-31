import { createApp, websocket } from "./app";
import { startGrpcServer } from "./grpc";

const app = createApp();
const port = Number(process.env.PORT || 3002);
const grpcPort = Number(process.env.GRPC_PORT || 50051);

startGrpcServer(grpcPort);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
