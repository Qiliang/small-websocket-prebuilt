import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  base: "./", //Use relative paths so it works at any mount path
  plugins: [react()],
  publicDir: "public",
  server: {
    allowedHosts: true, // Allows external connections like ngrok
    proxy: {
      // Proxy /api requests to the backend server
      "/api": {
        target: "http://0.0.0.0:8080", // Replace with your backend URL
        changeOrigin: true,
      },
      "/start": {
        target: "http://0.0.0.0:8080", // Replace with your backend URL
        changeOrigin: true,
      },
      "/sessions": {
        target: "http://0.0.0.0:8080", // Replace with your backend URL
        changeOrigin: true,
      },
      "/bot": {
        target: "http://0.0.0.0:8080",
        changeOrigin: true,
      },
      "/client": {
        target: "http://0.0.0.0:8080",
        changeOrigin: true,
      },
    },
  },
});
