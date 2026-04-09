/**
 * Next.js instrumentation hook
 * 在服务器启动时强制加载一次后台轮询器，
 * 避免依赖 layout.tsx 副作用导入被 tree-shake / 懒加载的问题。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/core/poller");
  }
}
