import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";

const PROTO_PATH = join(import.meta.dir, "../proto/echo.proto");

type EchoRequest = { message?: string };
type EchoResponse = { message: string };

export const startGrpcServer = (port: number): grpc.Server => {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    echo: {
      Echo: {
        service: grpc.ServiceDefinition;
      };
    };
  };

  const server = new grpc.Server();

  server.addService(proto.echo.Echo.service, {
    UnaryEcho: (
      call: grpc.ServerUnaryCall<EchoRequest, EchoResponse>,
      callback: grpc.sendUnaryData<EchoResponse>,
    ) => {
      callback(null, { message: call.request.message ?? "" });
    },
    ServerStreamingEcho: (call: grpc.ServerWritableStream<EchoRequest, EchoResponse>) => {
      const message = call.request.message ?? "";
      const parts = message.split("").filter(Boolean);
      const chunks = parts.length > 0 ? parts : [""];
      for (const chunk of chunks) {
        call.write({ message: chunk });
      }
      call.end();
    },
    ClientStreamingEcho: (
      call: grpc.ServerReadableStream<EchoRequest, EchoResponse>,
      callback: grpc.sendUnaryData<EchoResponse>,
    ) => {
      const parts: string[] = [];
      call.on("data", (req: EchoRequest) => {
        parts.push(req.message ?? "");
      });
      call.on("end", () => {
        callback(null, { message: parts.join("") });
      });
      call.on("error", (err) => {
        callback(err, null);
      });
    },
    BidirectionalStreamingEcho: (call: grpc.ServerDuplexStream<EchoRequest, EchoResponse>) => {
      call.on("data", (req: EchoRequest) => {
        call.write({ message: req.message ?? "" });
      });
      call.on("end", () => {
        call.end();
      });
    },
  });

  // Enable gRPC Server Reflection (grpcurl / Postman / BloomRPC without local .proto)
  const reflection = new ReflectionService(packageDefinition);
  reflection.addToServer(server);

  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      console.error("gRPC bind error:", err);
      return;
    }
    console.log(`gRPC Echo service listening on :${boundPort} (reflection enabled)`);
  });

  return server;
};
