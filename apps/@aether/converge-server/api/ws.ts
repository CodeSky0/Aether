// @aether/converge-server · Vercel Function 部署入口
// Vercel 将 api/ 目录下的文件自动编译为 Node.js Functions：
// 本文件路由到 /api/ws，承载 Hocuspocus WebSocket 收敛服务。
// 部署文档见 docs/vercel-deploy.md。
export { default } from '../src/vercel.js'
