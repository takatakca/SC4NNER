import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["client.ts"],
  outfile: "dist/client.js",
  bundle: true,
  minify: true,
  platform: "browser",
  target: "es2022",
});
await build({
  entryPoints: ["worker.mjs"],
  outfile: "dist/server/index.js",
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".html": "text" },
  plugins: [
    {
      name: "client-text",
      setup(b) {
        // Barre oblique ou inverse : même règle sous Linux et Windows.
        b.onLoad({ filter: /dist[\\/]client\.js$/ }, async ({ path }) => ({
          contents: await (
            await import("node:fs/promises")
          ).readFile(path, "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
