// @aether/web · Vitest 全局 setup
// 注册 @testing-library/jest-dom 自定义 matchers（toBeInTheDocument 等）。
// node 环境测试不使用 DOM 断言，注册无副作用；jsdom 环境组件测试依赖此 setup。
import '@testing-library/jest-dom/vitest'

// jsdom 不实现 Element.scrollIntoView，组件 useEffect 中调用会抛 TypeError。
// 仅在 DOM 环境下补桩（node 环境无 HTMLElement）。
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
}
