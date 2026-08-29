// @aether/web · 全局错误边界（Step 6 最后防线）
// 仅在 root layout 自身抛错时触发；必须自带 html/body。
// 样式走内联最小 Yohaku（此时全局 CSS 可能未加载）。
'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf9f7',
          color: '#3a3835',
          fontFamily: 'serif',
          gap: '12px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '24px', fontWeight: 500, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ color: '#a63d40', fontSize: '14px', margin: 0, maxWidth: '420px' }}>
          {error.message || '服务暂时不可用。'}
        </p>
        <p style={{ fontSize: '12px', opacity: 0.7, margin: 0 }}>
          页面外壳发生错误；重试或返回首页。
        </p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid #3a3835',
              background: '#3a3835',
              color: '#faf9f7',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          <a
            href="/realms"
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid #d9d5ce',
              background: 'transparent',
              color: '#3a3835',
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            Return to Realm
          </a>
        </div>
      </body>
    </html>
  )
}
