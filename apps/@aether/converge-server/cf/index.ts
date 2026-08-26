// @aether/converge-server · Cloudflare Workers 入口。
// 零成本部署（免费计划，无需信用卡）：以 Durable Object 承载 Yjs 收敛服务。
//
// 路由：
//   GET /health            → 健康检查
//   GET /ws/:docName       → WebSocket 升级，按 docName 路由到对应 YjsRoom DO
//
// 与 Node/Vercel 部署（src/index.ts + api/ws.ts）的关系：
//   三者共用 @aether 的文档契约，CF 入口不依赖任何 Node API，
//   部署目标互不影响；生产推荐 CF（免费、零冷启动、原生 WebSocket）。
//
// 部署：pnpm --filter @aether/converge-server deploy:cf
import { YjsRoom } from './yjs-room.js'

export { YjsRoom }

export interface Env {
  YJS_ROOM: DurableObjectNamespace
}

const WS_PATH_PATTERN = /^\/ws\/(.+)$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const match = WS_PATH_PATTERN.exec(url.pathname)
    if (!match?.[1]) {
      return new Response('Not Found', { status: 404 })
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    // docName 经 encodeURIComponent 编码后置于路径（如 realm%3Ademo-123）
    const docName = decodeURIComponent(match[1])
    const id = env.YJS_ROOM.idFromName(docName)
    return env.YJS_ROOM.get(id).fetch(request)
  },
}
