// @aether/converge-server · 健康检查端点
// 访问 /health 返回服务状态，用于运维监控与连接验证。
// Vercel Node.js Function signature: (req, res) => void
export default function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json')
  res.status(200).json({
    status: 'ok',
    service: 'aether-converge-server',
    websocketEndpoint: '/api/ws',
    timestamp: new Date().toISOString(),
  })
}
