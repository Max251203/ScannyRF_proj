import json
from datetime import timedelta

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from django.contrib.auth.models import AnonymousUser
from django.db import transaction

from .models import DocumentDraft, BillingConfig


def _safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


def _ensure_overlay_ids(page_dict: dict):
    overlays = page_dict.get('overlays') or []
    changed = False
    for idx, o in enumerate(overlays):
        if 'id' not in o or not o['id']:
            o['id'] = f"ov_{timezone.now().timestamp():.0f}_{idx}"
            changed = True
    return changed


def _apply_patch_ops(snapshot: dict, ops: list[dict]) -> dict:
    """
    Применение лёгких патч-операций к snapshot черновика.
    Поддерживаемые операции:
      - {"op":"set_name", "name": str}
      - {"op":"rotate_page", "page": int, "landscape": bool}
      - {"op":"overlay_upsert", "page": int, "obj": {..., "id": str}}
      - {"op":"overlay_remove", "page": int, "id": str}
      - {"op":"page_set_meta", "page": int, "meta": {...}}
      - {"op":"page_add", "index": int, "page": {...}}
      - {"op":"page_remove", "index": int}
    """
    if not isinstance(snapshot, dict):
        return snapshot or {}

    pages = snapshot.get('pages') or []

    for op in ops or []:
        try:
            kind = (op.get('op') or '').lower()

            if kind == 'set_name':
                nm = (op.get('name') or '').strip()
                if nm:
                    snapshot['name'] = nm

            elif kind == 'rotate_page':
                i = int(op.get('page'))
                if 0 <= i < len(pages):
                    pages[i]['landscape'] = bool(op.get('landscape'))

            elif kind == 'overlay_upsert':
                i = int(op.get('page'))
                obj = op.get('obj') or {}
                if 0 <= i < len(pages) and isinstance(obj, dict):
                    _ensure_overlay_ids(pages[i])
                    ov = pages[i].setdefault('overlays', [])
                    oid = obj.get('id')
                    if not oid:
                        oid = f"ov_{timezone.now().timestamp():.0f}_{len(ov)}"
                        obj['id'] = oid
                    replaced = False
                    for k, ex in enumerate(ov):
                        if ex.get('id') == oid:
                            ov[k] = obj
                            replaced = True
                            break
                    if not replaced:
                        ov.append(obj)

            elif kind == 'overlay_remove':
                i = int(op.get('page'))
                oid = op.get('id')
                if 0 <= i < len(pages) and oid:
                    ov = pages[i].get('overlays') or []
                    pages[i]['overlays'] = [x for x in ov if x.get('id') != oid]

            elif kind == 'page_set_meta':
                i = int(op.get('page'))
                meta = op.get('meta') or {}
                if 0 <= i < len(pages) and isinstance(meta, dict):
                    overlays = pages[i].get('overlays') or []
                    landscape = bool(pages[i].get('landscape'))
                    pages[i] = {
                        **meta,
                        'overlays': overlays,
                        'landscape': landscape,
                    }

            elif kind == 'page_add':
                idx = int(op.get('index'))
                page_obj = op.get('page') or {}
                if isinstance(page_obj, dict):
                    page_obj.setdefault('overlays', [])
                    page_obj.setdefault('landscape', False)
                    if idx < 0:
                        idx = 0
                    if idx > len(pages):
                        idx = len(pages)
                    pages.insert(idx, page_obj)

            elif kind == 'page_remove':
                idx = int(op.get('index'))
                if 0 <= idx < len(pages):
                    pages.pop(idx)

        except Exception:
            # Пропускаем битые операции
            continue

    snapshot['pages'] = pages
    return snapshot


class EditorConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket для событий редактора.
    Путь: /ws/editor/<client_id>/?token=<JWT_ACCESS>

    Сообщения от клиента (JSON):
      - { "type":"patch", "ops": [...] }          # легковесные патчи
      - { "type":"commit", "snapshot": { ... } }  # полный снимок
      - { "type":"ping" }

    Ответы:
      - welcome / ack / committed / pong / error
    """

    async def connect(self):
        self.user = self.scope.get("user")
        self.client_id = (self.scope.get("url_route", {}).get("kwargs", {}) or {}).get("client_id")

        if not self.client_id:
            await self.close(code=4002)
            return

        if not self.user or isinstance(self.user, AnonymousUser) or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        await self.accept()
        await self.send_json({"type": "welcome", "client_id": self.client_id})

    async def disconnect(self, code):
        # Ничего дополнительного — “мгновенные” патчи уже применены
        return

    async def receive_json(self, content, **kwargs):
        msg_type = (content.get("type") or content.get("action") or "").lower()

        if msg_type == "patch":
            ops = content.get("ops") or []
            saved = await self._apply_patch_ops(ops)
            await self.send_json({"type": "ack", "saved": int(bool(saved))})

        elif msg_type == "commit":
            ok = await self._handle_commit(content)
            await self.send_json({"type": "committed", "ok": bool(ok)})

        elif msg_type == "ping":
            await self.send_json({"type": "pong"})

        else:
            await self.send_json({"type": "error", "detail": "unknown message type"})

    # ------ DB helpers (sync_to_async) ------

    @sync_to_async
    def _apply_patch_ops(self, ops: list[dict]) -> bool:
        try:
            d = DocumentDraft.objects.filter(user=self.user).first()
            if not d:
                return False

            # TTL продлеваем
            try:
                cfg = BillingConfig.objects.get(pk=1)
                ttl_h = _safe_int(cfg.draft_ttl_hours, 24)
            except BillingConfig.DoesNotExist:
                ttl_h = 24
            d.expires_at = timezone.now() + timedelta(hours=max(0, ttl_h))

            snap = d.data or {}
            if 'pages' not in snap or not isinstance(snap['pages'], list):
                snap['pages'] = []

            new_snap = _apply_patch_ops(snap, ops)
            d.data = new_snap

            with transaction.atomic():
                d.save(update_fields=["data", "expires_at", "updated_at"])
            return True
        except Exception:
            return False

    @sync_to_async
    def _handle_commit(self, content: dict) -> bool:
        snapshot = content.get("snapshot") or content.get("data") or {}
        if not isinstance(snapshot, dict):
            snapshot = {}

        # TTL часов из BillingConfig (если нет — 24)
        try:
            cfg = BillingConfig.objects.get(pk=1)
            ttl_h = _safe_int(cfg.draft_ttl_hours, 24)
        except BillingConfig.DoesNotExist:
            ttl_h = 24

        exp = timezone.now() + timedelta(hours=max(0, ttl_h))

        try:
            with transaction.atomic():
                # гарантируем id у overlays
                for p in (snapshot.get('pages') or []):
                    _ensure_overlay_ids(p)
                DocumentDraft.objects.update_or_create(
                    user=self.user,
                    defaults={"data": snapshot, "expires_at": exp},
                )
            return True
        except Exception:
            return False