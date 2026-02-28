import * as nodehttps from "https";
import * as nodehttp from "http";

type HttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Uint8Array[];
};

type HttpResponse = {
  url: string;
  method: string;
  statusCode: number | undefined;
  statusMessage: string | undefined;
  headers: Record<string, string>;
  body: AsyncIterableIterator<Uint8Array>;
};

/**
 * Custom isomorphic-git HTTP plugin with configurable socket timeout.
 * The default isomorphic-git/http/node has no timeout setting,
 * which causes failures on large vaults during initial push/fetch.
 */
export function makeHttpClient(timeoutMs: number) {
  return {
    async request({
      url,
      method = "GET",
      headers = {},
      body,
    }: HttpRequest): Promise<HttpResponse> {
      return new Promise((resolve, reject) => {
        const u = new URL(url);
        const isHttps = u.protocol === "https:";
        const proto = isHttps ? nodehttps : nodehttp;

        const options: nodehttps.RequestOptions = {
          hostname: u.hostname,
          port: u.port
            ? parseInt(u.port)
            : isHttps
            ? 443
            : 80,
          path: u.pathname + u.search,
          method,
          headers,
        };

        const req = proto.request(options, (res) => {
          const flatHeaders = Object.fromEntries(
            Object.entries(res.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(", ") : v ?? "",
            ])
          );

          // Collect chunks then expose as AsyncIterableIterator
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            async function* bodyGen() {
              for (const chunk of chunks) {
                yield new Uint8Array(chunk);
              }
            }
            const gen = bodyGen();
            resolve({
              url,
              method,
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              headers: flatHeaders,
              body: gen,
            });
          });
          res.on("error", reject);
        });

        // Set timeout on the socket once it's assigned
        req.on("socket", (socket) => {
          socket.setTimeout(timeoutMs);
          socket.on("timeout", () => {
            req.destroy(
              new Error(
                `Request timed out after ${Math.round(timeoutMs / 1000)}s`
              )
            );
          });
        });

        req.on("error", reject);

        // Write body (isomorphic-git sends body as AsyncIterable)
        if (body) {
          (async () => {
            try {
              for await (const chunk of body as AsyncIterable<Uint8Array>) {
                req.write(chunk);
              }
              req.end();
            } catch (e) {
              reject(e);
            }
          })();
        } else {
          req.end();
        }
      });
    },
  };
}
