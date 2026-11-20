import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { federation } from '@module-federation/vite'

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
// dev 仍挂根路径，localhost:5183/ 直接可开。
//
// 联邦远程入口：生产走同源 /syn-web/remoteEntry.js；开发跨 dev server 时
// 用 VITE_SYN_REMOTE_ENTRY 指向 syn-web（默认 http://localhost:5182）。
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  const synEntry =
    command === 'build'
      ? '/syn-web/remoteEntry.js'
      : env.VITE_SYN_REMOTE_ENTRY?.trim() || 'http://localhost:5182/remoteEntry.js'
  const sharedReact = { singleton: true, allowNodeModulesSuffixMatch: true } as const

  return {
    base: command === 'build' ? '/uiam-web/' : '/',
    plugins: [
      federation({
        name: 'uiam-web',
        remotes: {
          'syn-web': {
            type: 'module',
            name: 'syn-web',
            entry: synEntry,
            shareScope: 'default',
          },
        },
        shared: {
          react: sharedReact,
          'react/jsx-runtime': sharedReact,
          'react-dom': sharedReact,
          'react-dom/client': sharedReact,
        },
        manifest: true,
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      port: 5183,
      strictPort: false,
      proxy: {
        '/uiam': {
          target: env.VITE_PROXY_TARGET?.trim() || 'http://127.0.0.1:9009',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
