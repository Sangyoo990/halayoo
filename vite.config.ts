import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 상대 경로(base: "./")라서 dist 폴더를 아무 정적 호스팅에 올려도 동작합니다.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 3000 },
});
