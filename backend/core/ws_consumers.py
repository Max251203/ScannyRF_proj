import json
from datetime import timedelta

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from django.contrib.auth.models import AnonymousUser
from django.db import transaction

from .models import DocumentDraft, BillingConfig

# Опциональная модель событий — добавим, если есть в моделях проекта.
# Если вы ещё не добавили DraftEvent в core.models — добавьте (см. последующие файлы).
try:
    from .models import DraftEvent  # type: ignore
except Exception:  # pragma: no cover
    DraftEvent = None  # fallback, чтобы не падало при импорт-цикле


def _safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


class EditorConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket для событий редактора.
    Путь: /ws/editor/<client_id>/?token=<JWT_ACCESS>

    Сообщения от клиента (JSON):
      - { "type":"event",  "kind": "<string>", "payload": {...} }
      - { "type":"events", "events": [ { "kind": "...", "payload": {...} }, ... ] }
      - { "type":"commit", "snapshot": { ...полный сериализованный документ... } }
      - { "type":"ping" }

    Ответы:
      - welcome / ack / committed / pong / error
    """

    async def connect(self):
        self.user = self.scope.get("user")  # Устанавливается в JWTAuthMiddleware
        self.client_id = (self.scope.get("url_route", {}).get("kwargs", {}) or {}).get(
            "client_id"
        )

        if not self.client_id:
            await self.close(code=4002)
            return

        if not self.user or isinstance(self.user, AnonymousUser) or not self.user.is_authenticated:
            # Неавторизованные не допускаются
            await self.close(code=4001)
            return

        await self.accept()
        await self.send_json(
            {
                "type": "welcome",
                "client_id": self.client_id,
            }
        )

    async def receive_json(self, content, **kwargs):
        msg_type = (content.get("type") or content.get("action") or "").lower()

        if msg_type in ("event", "events"):
            saved = await self._handle_events(content)
            await self.send_json({"type": "ack", "saved": saved})

        elif msg_type == "commit":
            ok = await self._handle_commit(content)
            await self.send_json({"type": "committed", "ok": bool(ok)})

        elif msg_type == "ping":
            await self.send_json({"type": "pong"})

        else:
            await self.send_json({"type": "error", "detail": "unknown message type"})

    # ------ Handlers ------

    async def _handle_events(self, content: dict):
        """
        Сохраняем события (мелкие патчи) в БД как DraftEvent — это "запись изменений".
        """
        if DraftEvent is None:
            # Если модель не подключена — просто "делаем вид", что сохранили
            return 0

        events = content.get("events")
        if not events:
            # единичное событие через поля kind/payload
            events = [
                {
                    "kind": content.get("kind") or content.get("event") or "unknown",
                    "payload": content.get("payload") or content.get("data") or {},
                }
            ]

        # нормализуем
        norm = []
        for ev in events:
            kind = str(ev.get("kind") or "unknown")[:64]
            payload = ev.get("payload") or ev.get("data") or {}
            # payload должен быть JSON-совместимым
            try:
                json.dumps(payload)
            except Exception:
                # если прислали неjson, превращаем в строку
                payload = {"value": str(payload)}
            norm.append({"kind": kind, "payload": payload})

        return await self._store_events(norm)

    async def _handle_commit(self, content: dict):
        """
        Финальное сохранение: пишем в DocumentDraft полный снимок (snapshot),
        TTL берём из BillingConfig, удаляем накопленные события по client_id.
        """
        snapshot = content.get("snapshot") or content.get("data") or {}
        if not isinstance(snapshot, dict):
            snapshot = {}

        return await self._commit_snapshot(snapshot)

    # ------ DB helpers (sync_to_async) ------

    @sync_to_async
    def _store_events(self, events: list[dict]):
        if DraftEvent is None:
            return 0
        saved = 0
        with transaction.atomic():
            for ev in events:
                DraftEvent.objects.create(
                    user=self.user,
                    client_id=self.client_id,
                    kind=(ev.get("kind") or "unknown")[:64],
                    payload=ev.get("payload") or {},
                )
                saved += 1
        return saved

    @sync_to_async
    def _commit_snapshot(self, snapshot: dict):
        # TTL часов из BillingConfig (если нет — 24)
        try:
            cfg = BillingConfig.objects.get(pk=1)
            ttl_h = _safe_int(cfg.draft_ttl_hours, 24)
        except BillingConfig.DoesNotExist:
            ttl_h = 24

        exp = timezone.now() + timedelta(hours=max(0, ttl_h))

        with transaction.atomic():
            DocumentDraft.objects.update_or_create(
                user=self.user,
                defaults={"data": snapshot, "expires_at": exp},
            )
            if DraftEvent is not None:
                DraftEvent.objects.filter(
                    user=self.user, client_id=self.client_id
                ).delete()

        return True