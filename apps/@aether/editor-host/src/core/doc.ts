// @aether/editor-host · Y.Doc 工厂 —— 每文件独立 Yjs Doc。
// doc_ref = file:{realmSlug}:{filePath}，每个文件一个独立 Y.Doc，
// 文本存于顶层 'text' Y.Text（不再用 content Map 多 key）。
// converge-server 按 (realmId, docRef) 路由，天然按文件隔离。
import * as Y from 'yjs'

/** 顶层 Y.Text 的 key（每文件独立 Doc，文本存于顶层） */
export const TEXT_KEY = 'text'

/** 由 realm + filePath 派生稳定的 doc_ref（每文件独立 Yjs Doc） */
export function docRefForFile(realmSlug: string, filePath: string): string {
  return `file:${realmSlug}:${filePath}`
}

/**
 * @deprecated 用 docRefForFile 代替。
 * 保留供 drift 测试兼容；生产代码应用 docRefForFile 按文件派生 doc_ref。
 */
export function docRefForRealm(realmSlug: string): string {
  return docRefForFile(realmSlug, '__realm__')
}

/**
 * 创建 Y.Doc 基线，doc_ref 作为文档唯一标识。
 */
export function createRealmDoc(docRef: string): Y.Doc {
  const doc = new Y.Doc()
  doc.guid = docRef
  return doc
}

/** 取或建顶层 Y.Text（每文件独立 Doc，文本存于顶层 'text' key） */
export function getOrCreateText(doc: Y.Doc): Y.Text {
  return doc.getText(TEXT_KEY)
}
