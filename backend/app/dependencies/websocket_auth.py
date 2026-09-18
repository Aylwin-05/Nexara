from app.services.jwt_service import JWTService
from fastapi import WebSocket


class WebSocketAuth:
    """
    Handles authentication for WebSocket connections.

    The JWT is carried in the `Sec-WebSocket-Protocol` header
    as a subprotocol named `nexara.<token>` instead of
    a query parameter, so it never leaks into access / proxy logs.
    """

    TOKEN_PREFIX = "nexara."  # noqa: S105 - subprotocol prefix, not a secret

    def __init__(self):
        self.jwt_service = JWTService()

    def extract_token(
        self,
        websocket: WebSocket,
    ) -> tuple[str | None, str | None]:
        """
        Returns (token, full_subprotocol).
        """

        header = websocket.headers.get(
            "sec-websocket-protocol",
            "",
        )

        for offered in header.split(","):
            offered = offered.strip()

            if offered.startswith(self.TOKEN_PREFIX):
                return (
                    offered[len(self.TOKEN_PREFIX) :],
                    offered,
                )

        return (
            None,
            None,
        )

    async def authenticate(
        self,
        websocket: WebSocket,
    ):
        """
        Authenticate a websocket using the JWT access token
        supplied through the WebSocket subprotocol.

        Returns `(payload, subprotocol)` on success
        or `(None, None)` after closing the connection.
        """

        token, subprotocol = self.extract_token(websocket)

        if not token:
            await websocket.close(code=1008)
            return (
                None,
                None,
            )

        payload = self.jwt_service.verify_access_token(token)

        if payload is None:
            await websocket.close(code=1008)
            return (
                None,
                None,
            )

        return (
            payload,
            subprotocol,
        )


websocket_auth = WebSocketAuth()
