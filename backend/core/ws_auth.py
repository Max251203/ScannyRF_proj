from urllib.parse import parse_qs

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _get_user_from_token(token_str):
    """
    Возвращает пользователя по JWT access-токену.
    Если токен невалиден/пользователь не найден — AnonymousUser.
    """
    try:
        token = AccessToken(token_str)
        uid = token.get("user_id")
        if not uid:
            return AnonymousUser()
        User = get_user_model()
        return User.objects.get(pk=uid)
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware:
    """
    Channels middleware для аутентификации по JWT в WebSocket.
    - Ищет токен в query (?token=...)
    - Либо в заголовке Authorization: Bearer <token>
    Устанавливает scope['user'].
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        scope["user"] = AnonymousUser()

        # 1) query string ?token=...
        query = scope.get("query_string", b"").decode("utf-8", errors="ignore")
        token = None
        if query:
            qs = parse_qs(query)
            token = (qs.get("token") or [None])[0]

        # 2) Authorization: Bearer <token>
        if not token:
            try:
                headers = dict(scope.get("headers") or [])
                auth = headers.get(b"authorization")
                if auth:
                    parts = auth.split()
                    if len(parts) == 2 and parts[0].lower() == b"bearer":
                        token = parts[1].decode("utf-8", errors="ignore")
            except Exception:
                token = None

        # Устанавливаем пользователя
        if token:
            scope["user"] = await _get_user_from_token(token)

        return await self.inner(scope, receive, send)


def JWTAuthMiddlewareStack(inner):
    """
    Обертка как в channels.auth.AuthMiddlewareStack,
    но с поддержкой JWT в query/header.
    """
    return JWTAuthMiddleware(AuthMiddlewareStack(inner))