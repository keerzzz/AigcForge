export * as McpOAuthProviderV2 from "./v2-oauth-provider"

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { Effect } from "effect"
import type { Interface as McpAuthInterface } from "./v2-auth"

const OAUTH_CALLBACK_PORT = 19876
const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH }

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  redirectUri?: string
}

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
    private auth: McpAuthInterface,
  ) {}

  get redirectUrl(): string {
    if (this.config.redirectUri) return this.config.redirectUri
    const port = this.config.callbackPort ?? OAUTH_CALLBACK_PORT
    return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "Aigcfroge",
      client_uri: "https://aigcfroge.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this.config.clientId) {
      return { client_id: this.config.clientId, client_secret: this.config.clientSecret }
    }
    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
    if (entry?.clientInfo) {
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000)
        return undefined
      return { client_id: entry.clientInfo.clientId, client_secret: entry.clientInfo.clientSecret }
    }
    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await Effect.runPromise(
      this.auth.updateClientInfo(
        this.mcpName,
        {
          clientId: info.client_id,
          clientSecret: info.client_secret,
          clientIdIssuedAt: info.client_id_issued_at,
          clientSecretExpiresAt: info.client_secret_expires_at,
        },
        this.serverUrl,
      ),
    )
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
    if (!entry?.tokens) return undefined
    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await Effect.runPromise(
      this.auth.updateTokens(
        this.mcpName,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
          scope: tokens.scope,
        },
        this.serverUrl,
      ),
    )
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await Effect.runPromise(this.auth.updateCodeVerifier(this.mcpName, codeVerifier))
  }

  async codeVerifier(): Promise<string> {
    const entry = await Effect.runPromise(this.auth.get(this.mcpName))
    if (!entry?.codeVerifier) throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    return entry.codeVerifier
  }

  async saveState(state: string): Promise<void> {
    await Effect.runPromise(this.auth.updateOAuthState(this.mcpName, state))
  }

  async state(): Promise<string> {
    const entry = await Effect.runPromise(this.auth.get(this.mcpName))
    if (entry?.oauthState) return entry.oauthState
    const newState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await Effect.runPromise(this.auth.updateOAuthState(this.mcpName, newState))
    return newState
  }

  async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    const entry = await Effect.runPromise(this.auth.get(this.mcpName))
    if (!entry) return
    switch (type) {
      case "all":
        await Effect.runPromise(this.auth.remove(this.mcpName))
        break
      case "client":
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- persisted Entry fields are readonly; delete requires a mutable view
        delete (entry as any).clientInfo
        await Effect.runPromise(this.auth.set(this.mcpName, entry))
        break
      case "tokens":
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- persisted Entry fields are readonly; delete requires a mutable view
        delete (entry as any).tokens
        await Effect.runPromise(this.auth.set(this.mcpName, entry))
        break
    }
  }
}

export function parseRedirectUri(redirectUri?: string): { port: number; path: string } {
  if (!redirectUri) return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }
  try {
    const url = new URL(redirectUri)
    return {
      port: url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80,
      path: url.pathname || OAUTH_CALLBACK_PATH,
    }
  } catch {
    return { port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH }
  }
}
