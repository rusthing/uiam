import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 开发期把 /uiam 反代到本机 uiam-svr（9002），生产由网关按**服务名前缀**
// `/uiam-svr` 转发并剥掉第一段，两边都不需要 CORS 配置——这也是 uiam 自己发布出去
// 的那份 TOML 在做的事。
//
// ⚠️ 两个前缀是两件事，别混：
//   · `/uiam`     —— uiam-svr **内部**路由前缀（ctrl 名首段推导出来的），开发期直接反代它
//   · `/uiam-svr` —— 网关上的**服务名**前缀，生产接口基地址（见 `.env.production`
//                    的 VITE_API_BASE），网关 StripPrefix 之后剩下的才是 `/uiam/...`
//
// 生产静态站挂在 gatex 的 static/uiam-web/ 下，路由前缀就是 /uiam-web，
// 所以构建产物的资源引用必须带这个前缀（与 adm-rs-web / syn-web 等一致）；
// dev 仍挂根路径，localhost:5182/ 直接可开。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/uiam-web/' : '/',
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
}))
