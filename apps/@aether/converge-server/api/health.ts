// @aether/converge-server · 健康检查端点
// 访问 /health 返回服务状态，用于运维监控与连接验证。
export default function handler(req: Request) {
  return Response.json({
    status: 'ok',
    service: 'aether-converge-server',
    websocketEndpoint: '/api/ws',
    timestamp: new Date().toISOString(),
  })
}
