/**
 * View Transitions API 的类型补充。
 *
 * TS 的 DOM lib 目前还没有 `document.startViewTransition`（各浏览器实现已久，
 * 但类型定义还没跟上），这里只声明本项目用到的那一小部分。
 */
interface ViewTransition {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition(): void
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition
}
