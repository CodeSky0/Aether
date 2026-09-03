// @aether/converge-server · 健康检查端点
// 访问 /health 返回服务状态，用于运维监控与连接验证。
// Vercel Node.js Function signature: (req, res) => void
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Vercel Node.js Function 提供 Express 风格的 status/json 扩展。 */
interface HealthResponse extends ServerResponse {
  status(code: number): HealthResponse
  json(body: unknown): void
}

export default function handler(
  _req: IncomingMessage,
  res: HealthResponse,
): void {
  res.setHeader('Content-Type', 'application/json')
  res.status(200).json({
    status: 'ok',
    service: 'aether-converge-server',
    websocketEndpoint: '/api/ws',
    timestamp: new Date().toISOString(),
  })
}
