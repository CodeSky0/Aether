// @aether/converge-server · Vercel Function 入口（WebSocket）
// Vercel Node.js runtime 识别默认导出的 http.Server，并支持 WebSocket upgrade
// （参考 Vercel 官方 WebSockets 文档：export default server + WebSocketServer({ server })）。
//
// 部署约定：本文件被 api/ws.ts 重导出，Vercel 将 api/ws.ts 编译为
// /api/ws 路径的 Node.js Function。
//
// 限制：Vercel Function 有最大时长（Hobby 300s / Pro 最大 800s），
// WebSocket 连接到期会被 Vercel 关闭，客户端依赖 Yjs 重连机制恢复。
// 跨实例消息广播依赖 REDIS_URL（建议 Upstash Redis）。
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import { type Hocuspocus, createHocuspocus } from './hocuspocus.js'

// 延迟初始化单例：模块加载不触碰 DATABASE_URL / REDIS_URL，
// 首次 WebSocket 连接到达时才创建 Hocuspocus 实例（同一函数实例内共享）。
let hocuspocusPromise: Promise<Hocuspocus> | null = null

function getHocuspocus(): Promise<Hocuspocus> {
  if (!hocuspocusPromise) {
    hocuspocusPromise = createHocuspocus()
  }
  return hocuspocusPromise
}

const server = http.createServer()

server.on('request', (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Aether converge-server (Vercel Function) is running')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, request) => {
  ws.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[converge-server] websocket error:', error)
  })
  void getHocuspocus().then(
    (hocuspocus) => {
      hocuspocus.handleConnection(ws, request)
    },
    (error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[converge-server] failed to create Hocuspocus instance:', error)
      ws.close(1011, 'converge-server unavailable')
    },
  )
})

export default server
