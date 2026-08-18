import type {
  ConnectFirstDraftSessionMessage,
  FirstDraftSessionIdentity,
} from "@repo/editor-first-draft/protocol";
import type { EditorRealtimeConfig } from "./config.ts";

export type EditorRealtimeAuthenticationResult =
  | ({ readonly ok: true } & FirstDraftSessionIdentity)
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

export interface EditorRealtimeAuthenticator {
  authenticateAndAuthorizeSession(
    message: ConnectFirstDraftSessionMessage,
  ):
    | Promise<EditorRealtimeAuthenticationResult>
    | EditorRealtimeAuthenticationResult;
}

export function createEditorRealtimeAuthenticator(
  config: EditorRealtimeConfig,
): EditorRealtimeAuthenticator {
  if (config.authMode === "dev-shared") {
    return new DevSharedRoomAuthenticator(config.devSharedToken);
  }
  return new JwtJwksAuthenticatorBoundary();
}

export class DevSharedRoomAuthenticator implements EditorRealtimeAuthenticator {
  constructor(private readonly expectedToken: string | undefined) {}

  authenticateAndAuthorizeSession(
    message: ConnectFirstDraftSessionMessage,
  ): EditorRealtimeAuthenticationResult {
    if (
      this.expectedToken === undefined ||
      message.authenticationToken !== this.expectedToken
    ) {
      return {
        ok: false,
        code: "unauthorized",
        message: "Invalid First Draft collaboration token",
      };
    }
    return {
      ok: true,
      actorId: message.actorId,
      clientId: message.clientId,
      sessionId: message.sessionId,
      documentId: message.documentId,
    };
  }
}

export class JwtJwksAuthenticatorBoundary
  implements EditorRealtimeAuthenticator
{
  authenticateAndAuthorizeSession(): EditorRealtimeAuthenticationResult {
    return {
      ok: false,
      code: "auth-mode-unavailable",
      message: "JWT/JWKS editor realtime auth is not implemented yet",
    };
  }
}
