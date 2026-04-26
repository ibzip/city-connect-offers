import { createServer } from "node:http";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./handler";

const port = Number(process.env.PORT ?? 3010);

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const event: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: `${request.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value ?? ""])),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "local",
      http: {
        method: request.method ?? "GET",
        path: url.pathname,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: request.headers["user-agent"] ?? "local",
      },
      requestId: "local",
      routeKey: `${request.method} ${url.pathname}`,
      stage: "$default",
      time: new Date().toUTCString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    body: Buffer.concat(chunks).toString("utf8") || undefined,
  };

  const result = await handler(event) as { statusCode?: number; headers?: Record<string, string>; body?: string };
  response.writeHead(result.statusCode ?? 200, result.headers ?? {});
  response.end(result.body ?? "");
});

server.listen(port, () => {
  console.log(`City Wallet API Gateway listening on http://localhost:${port}`);
  console.log(`City import provider env: ${process.env.CITY_IMPORT_POI_PROVIDER ?? "auto"}`);
  console.log(`Google Places key visible to API: ${process.env.GOOGLE_PLACES_API_KEY ? `yes (${maskSecret(process.env.GOOGLE_PLACES_API_KEY)})` : "no"}`);
});

function maskSecret(value: string) {
  if (value.length <= 8) return "set";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
