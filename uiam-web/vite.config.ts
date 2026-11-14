import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 开发期把 /uiam 反代到本机 uiam-svr（9002），生产由网关按前缀转发，
// 两边都不需要 CORS 配置——这也是 uiam 自己发布出去的那份 TOML 在做的事。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      '/uiam': {
        target: 'http://127.0.0.1:9002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
