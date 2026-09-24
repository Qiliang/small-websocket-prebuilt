import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

const SETTINGS_PATH = "/client/_settings";

/** Dev-only stand-in for settingsUrl (GET) and saveUrl (POST). Lost on restart. */
function memorySettingsPlugin() {
  let settings = {};

  const sendJson = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };

  return {
    name: "memory-settings",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== SETTINGS_PATH) {
          next();
          return;
        }

        if (req.method === "GET") {
          sendJson(res, 200, settings);
          return;
        }

        if (req.method !== "POST") {
          next();
          return;
        }

        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            sendJson(res, 400, { error: "invalid JSON" });
            return;
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            sendJson(res, 400, { error: "body must be a JSON object" });
            return;
          }
          settings = parsed;
          sendJson(res, 200, settings);
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const username = env.VITE_AUTH_USERNAME ?? "";
  const password = env.VITE_AUTH_PASSWORD ?? "";
  const headers =
    username || password
      ? {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        }
      : undefined;

  const proxyOptions = {
    target: "http://0.0.0.0:8080",
    changeOrigin: true,
    headers,
  };

  return {
    base: "./", //Use relative paths so it works at any mount path
    plugins: [react(), memorySettingsPlugin()],
    resolve: {
      alias: {
        vue: "vue/dist/vue.esm.js",
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          embed: "embed.html",
          host: "host.html",
        },
      },
    },
    publicDir: "public",
    server: {
      allowedHosts: true, // Allows external connections like ngrok
      proxy: {
        "/api": { ...proxyOptions },
        "/start": { ...proxyOptions },
        "/sessions": { ...proxyOptions },
        "/bot": { ...proxyOptions },
        "/client": { ...proxyOptions },
      },
    },
  };
});
