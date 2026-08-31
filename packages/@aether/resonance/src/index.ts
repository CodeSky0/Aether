// @aether/resonance · Resonance 公开扩展层
// 提供凭据加密、GitHub App OAuth（JWT / installation token / manifest）、
// Webhook Constellation、OAuth App Registry。
// 所有内部功能均通过本包暴露的公开 API 访问，实现 API-First。
// 明文密钥绝不入库：App private key 只存环境变量，installation token 加密缓存。

export {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  stringToBase64Url,
} from './encoding.js'
export {
  encryptSecret,
  decryptSecret,
  importAesKey,
  ResonanceCryptoError,
} from './crypto.js'
export { signAppJwt, GithubJwtError, type GithubAppCredentials } from './github-jwt.js'
export {
  fetchInstallationAccessToken,
  GithubInstallationError,
  type InstallationAccessToken,
} from './github-installation.js'
export {
  createAppFromManifest,
  aetherGithubAppManifest,
  GithubManifestError,
  type GithubAppManifest,
  type GithubAppCreationResult,
} from './github-manifest.js'
