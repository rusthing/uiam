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
// 联邦远程入口：生产走同源 /<app>-web/remoteEntry.js；开发跨 dev server 时
// 用 VITE_<APP>_REMOTE_ENTRY 指向对应子应用（端口见各端 vite.config）。
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  // 生产走同源静态前缀下的 remoteEntry.js；开发跨 dev server 时用 VITE_XXX_REMOTE_ENTRY 覆盖。
  // 注意 adm/dtw 的前缀带 -rs（/adm-rs-web/、/dtw-rs-web/），不能靠应用名拼出来。
  const remoteEntry = (prodPath: string, envKey: string, devDefault: string) =>
    command === 'build' ? prodPath : env[envKey]?.trim() || devDefault
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
            entry: remoteEntry('/syn-web/remoteEntry.js', 'VITE_SYN_REMOTE_ENTRY', 'http://localhost:5182/remoteEntry.js'),
            shareScope: 'default',
          },
          'msg-web': {
            type: 'module',
            name: 'msg-web',
            entry: remoteEntry('/msg-web/remoteEntry.js', 'VITE_MSG_REMOTE_ENTRY', 'http://localhost:5175/remoteEntry.js'),
            shareScope: 'default',
          },
          'alarm-web': {
            type: 'module',
            name: 'alarm-web',
            entry: remoteEntry('/alarm-web/remoteEntry.js', 'VITE_ALARM_REMOTE_ENTRY', 'http://localhost:5176/remoteEntry.js'),
            shareScope: 'default',
          },
          'dbz-web': {
            type: 'module',
            name: 'dbz-web',
            entry: remoteEntry('/dbz-web/remoteEntry.js', 'VITE_DBZ_REMOTE_ENTRY', 'http://localhost:5174/remoteEntry.js'),
            shareScope: 'default',
          },
          // adm/dtw 的静态前缀带 -rs（见各自 .env.production 的 PUBLIC_BASE
          // 与 gatex 的 static bases），与 meta.url 一致，不能靠应用名拼。
          'adm-web': {
            type: 'module',
            name: 'adm-web',
            entry: remoteEntry('/adm-rs-web/remoteEntry.js', 'VITE_ADM_REMOTE_ENTRY', 'http://localhost:5181/remoteEntry.js'),
            shareScope: 'default',
          },
          'dtw-web': {
            type: 'module',
            name: 'dtw-web',
            entry: remoteEntry('/dtw-rs-web/remoteEntry.js', 'VITE_DTW_REMOTE_ENTRY', 'http://localhost:5186/remoteEntry.js'),
            shareScope: 'default',
          },
          'jobx-web': {
            type: 'module',
            name: 'jobx-web',
            entry: remoteEntry('/jobx-web/remoteEntry.js', 'VITE_JOBX_REMOTE_ENTRY', 'http://localhost:5180/remoteEntry.js'),
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
