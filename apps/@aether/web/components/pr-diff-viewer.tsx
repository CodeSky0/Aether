// @aether/web · PR Diff Viewer
// 结构化渲染 PR 文件 diff：文件头 + patch hunks（added/removed/context 着色）。
// Yohaku：mono 代码、1px border、绿色 added / 红色 removed / neutral context。
'use client'
import type { PRFile } from '@/lib/github-api'

interface PrDiffViewerProps {
  files: PRFile[]
}

export function PrDiffViewer({ files }: PrDiffViewerProps) {
  if (files.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
        <p className="text-copy-13 text-neutral-7">无文件变更</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <div key={file.filename} className="rounded-md border border-border overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-neutral-1 px-3 py-2">
            <span className="font-mono text-label-12 text-neutral-9">{file.filename}</span>
            <span className="ml-auto shrink-0 font-mono text-caption-10 text-neutral-6">
              +{file.additions} −{file.deletions}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-caption-10 uppercase ${
              file.status === 'added' ? 'bg-green-6/10 text-green-6'
                : file.status === 'removed' ? 'bg-red-6/10 text-red-6'
                : 'bg-neutral-2 text-neutral-6'
            }`}>
              {file.status}
            </span>
          </div>
          {file.patch ? (
            <div className="overflow-x-auto bg-neutral-1">
              <pre className="px-3 py-2 font-mono text-caption-10 leading-relaxed">
                {file.patch.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={`${
                      line.startsWith('+') && !line.startsWith('+++')
                        ? 'bg-green-6/5 text-green-7'
                        : line.startsWith('-') && !line.startsWith('---')
                          ? 'bg-red-6/5 text-red-7'
                          : line.startsWith('@@')
                            ? 'text-neutral-5'
                            : 'text-neutral-7'
                    }`}
                  >
                    {line || ' '}
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <div className="px-3 py-2 font-mono text-caption-10 text-neutral-6">
              二进制文件，无法显示 diff
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
