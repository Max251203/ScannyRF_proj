import time
import base64
import copy
from datetime import timedelta

import requests
from django.utils import timezone
from django.db.models import Sum, Q
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Subscription,
    Operation,
    BillingConfig,
    PromoCode,
    SignImage,
    GlobalSignImage,
    HiddenDefaultSign,
    Upload,
    DocumentDraft,
)

# ---------- Ключевая ставка ЦБ ----------
_KEY_RATE_CACHE = {"data": None, "ts": 0, "ttl": 3600}  # 1 час


class KeyRateView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        now = time.time()
        if _KEY_RATE_CACHE["data"] and (now - _KEY_RATE_CACHE["ts"] < _KEY_RATE_CACHE["ttl"]):
            return Response(_KEY_RATE_CACHE["data"])

        url = "https://www.cbr-xml-daily.ru/key-rate.json"
        try:
            r = requests.get(url, timeout=6)
            r.raise_for_status()
            j = r.json() if r.content else {}
            key_rate = float(j.get("keyRate"))
            date = j.get("date") or ""
            data = {"keyRate": key_rate, "date": date}
            _KEY_RATE_CACHE["data"] = data
            _KEY_RATE_CACHE["ts"] = now
            return Response(data)
        except Exception:
            if _KEY_RATE_CACHE["data"]:
                return Response(_KEY_RATE_CACHE["data"])
            return Response({"keyRate": 16.0, "date": ""})


# ---------- Вспомогательные ----------
def _get_quota():
    cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={
        'free_daily_quota': 3,
        'draft_ttl_hours': 24,
        'price_single': 99,
        'price_month': 399,
        'price_year': 3999,
    })
    return int(cfg.free_daily_quota or 0)


def _get_ttl_hours():
    cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={
        'free_daily_quota': 3,
        'draft_ttl_hours': 24,
        'price_single': 99,
        'price_month': 399,
        'price_year': 3999,
    })
    return max(0, int(cfg.draft_ttl_hours or 0))


def _get_prices_dict():
    cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={
        'free_daily_quota': 3,
        'draft_ttl_hours': 24,
        'price_single': 99,
        'price_month': 399,
        'price_year': 3999,
    })
    return {
        "price_single": int(cfg.price_single or 0),
        "price_month": int(cfg.price_month or 0),
        "price_year": int(cfg.price_year or 0),
    }


def _billing_status(user):
    tz = timezone.get_default_timezone()
    now = timezone.now().astimezone(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)  # полночь локальной TZ

    free_total = _get_quota()
    free_used = (
        Operation.objects.filter(user=user, free=True, created_at__gte=start)
        .aggregate(total=Sum('pages'))
        .get('total') or 0
    )
    free_left = max(0, free_total - int(free_used))

    sub = Subscription.objects.filter(user=user, expires_at__gt=timezone.now()).order_by('-expires_at').first()

    uploads = Upload.objects.filter(user=user).values(
        'id', 'client_id', 'doc_name', 'pages', 'created_at', 'auto_delete_at', 'deleted'
    )

    return {
        "free_total": free_total,
        "free_used": int(free_used),
        "free_left": free_left,
        "reset_at": (start + timedelta(days=1)).isoformat(),
        "subscription": ({
            "plan": sub.plan,
            "expires_at": sub.expires_at.isoformat()
        } if sub else None),
        "uploads": list(uploads),
        "draft_ttl_hours": _get_ttl_hours(),
        **_get_prices_dict(),
    }


# ---------- Биллинг / история ----------
class BillingStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_billing_status(request.user))


class BillingRecordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        kind = (request.data.get('kind') or '').lower()  # 'jpg' | 'pdf'
        pages = max(1, int(request.data.get('pages') or 1))
        mode = (request.data.get('mode') or 'free').lower()  # 'free'|'paid'
        doc_name = (request.data.get('doc_name') or '')[:200]

        if kind not in ('jpg', 'pdf'):
            return Response({'detail': 'kind должен быть jpg|pdf'}, status=400)

        has_sub = Subscription.objects.filter(user=request.user, expires_at__gt=timezone.now()).exists()
        if mode == 'free' and not has_sub:
            st = _billing_status(request.user)
            if st['free_left'] < pages:
                return Response({'detail': 'Лимит бесплатных страниц на сегодня исчерпан'}, status=403)

        Operation.objects.create(
            user=request.user,
            kind=f'download_{kind}',
            pages=pages,
            doc_name=doc_name,
            free=(mode == 'free'),
        )
        return Response(_billing_status(request.user))


# ---------- Конфигурация биллинга ----------
class BillingConfigView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={
            'free_daily_quota': 3,
            'draft_ttl_hours': 24,
            'price_single': 99,
            'price_month': 399,
            'price_year': 3999,
        })
        return Response({
            "free_daily_quota": cfg.free_daily_quota,
            "draft_ttl_hours": cfg.draft_ttl_hours,
            "price_single": cfg.price_single,
            "price_month": cfg.price_month,
            "price_year": cfg.price_year,
        })

    def put(self, request):
        cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={
            'free_daily_quota': 3,
            'draft_ttl_hours': 24,
            'price_single': 99,
            'price_month': 399,
            'price_year': 3999,
        })

        fval = request.data.get('free_daily_quota', None)
        tval = request.data.get('draft_ttl_hours', None)
        p_single = request.data.get('price_single', None)
        p_month = request.data.get('price_month', None)
        p_year = request.data.get('price_year', None)

        if fval is not None:
            try:
                fval = int(fval)
                if fval < 0:
                    raise ValueError
                cfg.free_daily_quota = fval
            except Exception:
                return Response({'detail': 'free_daily_quota должен быть неотрицательным числом'}, status=400)

        if tval is not None:
            try:
                tval = int(tval)
                if tval < 0:
                    raise ValueError
                cfg.draft_ttl_hours = tval
            except Exception:
                return Response({'detail': 'draft_ttl_hours должен быть неотрицательным числом'}, status=400)

        def _set_price(name, val):
            try:
                ival = int(val)
                if ival < 0:
                    raise ValueError
                setattr(cfg, name, ival)
                return None
            except Exception:
                return Response({'detail': f'{name} должен быть неотрицательным числом'}, status=400)

        if p_single is not None:
            bad = _set_price('price_single', p_single)
            if bad:
                return bad
        if p_month is not None:
            bad = _set_price('price_month', p_month)
            if bad:
                return bad
        if p_year is not None:
            bad = _set_price('price_year', p_year)
            if bad:
                return bad

        cfg.save()
        return Response({
            "free_daily_quota": cfg.free_daily_quota,
            "draft_ttl_hours": cfg.draft_ttl_hours,
            "price_single": cfg.price_single,
            "price_month": cfg.price_month,
            "price_year": cfg.price_year,
        })


class PublicBillingConfigView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(_get_prices_dict())


# ---------- Промокоды (админ CRUD + проверка) ----------
class PromoListCreate(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        qs = PromoCode.objects.all().values('id', 'code', 'discount_percent', 'active', 'note', 'created_at')
        return Response(list(qs))

    def post(self, request):
        code = (request.data.get('code') or '').strip()
        try:
            discount = int(request.data.get('discount_percent') or 0)
        except Exception:
            return Response({'detail': 'discount_percent должен быть числом'}, status=400)
        active = bool(request.data.get('active') in (True, 'true', '1', 1))
        note = (request.data.get('note') or '')[:200]
        if not code:
            return Response({'detail': 'code обязателен'}, status=400)
        if discount < 0 or discount > 100:
            return Response({'detail': 'discount_percent должен быть в диапазоне 0..100'}, status=400)
        if PromoCode.objects.filter(code__iexact=code).exists():
            return Response({'detail': 'Такой промокод уже существует'}, status=400)
        obj = PromoCode.objects.create(code=code, discount_percent=discount, active=active, note=note)
        return Response({'id': obj.id, 'code': obj.code, 'discount_percent': obj.discount_percent, 'active': obj.active, 'note': obj.note}, status=201)


class PromoDetail(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get_obj(self, pk):
        return PromoCode.objects.get(pk=pk)

    def get(self, request, pk):
        obj = self.get_obj(pk)
        return Response({'id': obj.id, 'code': obj.code, 'discount_percent': obj.discount_percent, 'active': obj.active, 'note': obj.note})

    def put(self, request, pk):
        obj = self.get_obj(pk)
        code = (request.data.get('code') or '').strip()
        try:
            discount = int(request.data.get('discount_percent') or 0)
        except Exception:
            return Response({'detail': 'discount_percent должен быть числом'}, status=400)
        active = bool(request.data.get('active') in (True, 'true', '1', 1))
        note = (request.data.get('note') or '')[:200]
        if not code:
            return Response({'detail': 'code обязателен'}, status=400)
        if discount < 0 or discount > 100:
            return Response({'detail': 'discount_percent должен быть в диапазоне 0..100'}, status=400)
        if PromoCode.objects.exclude(pk=obj.pk).filter(code__iexact=code).exists():
            return Response({'detail': 'Промокод с таким кодом уже существует'}, status=400)
        obj.code = code
        obj.discount_percent = discount
        obj.active = active
        obj.note = note
        obj.save()
        return Response({'id': obj.id, 'code': obj.code, 'discount_percent': obj.discount_percent, 'active': obj.active, 'note': obj.note})

    def delete(self, request, pk):
        self.get_obj(pk).delete()
        return Response(status=204)


class PromoValidateView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        code = (request.data.get('code') or '').strip()
        if not code:
            return Response({'percent': 0})
        obj = PromoCode.objects.filter(code__iexact=code, active=True).first()
        return Response({'percent': int(obj.discount_percent) if obj else 0})


# ---------- Библиотека подписей/печати ----------
def _sign_to_dict(obj: SignImage):
    b64 = base64.b64encode(obj.data).decode('ascii')
    url = f"data:{obj.mime};base64,{b64}"
    return {
        "id": obj.id,
        "kind": obj.kind,
        "mime": obj.mime,
        "url": url,
        "created_at": obj.created_at.isoformat(),
        "is_default": False,
    }


def _default_sign_to_dict(obj: GlobalSignImage):
    b64 = base64.b64encode(obj.data).decode('ascii')
    url = f"data:{obj.mime};base64,{b64}"
    return {
        "id": f"g_{obj.id}",
        "gid": obj.id,
        "kind": obj.kind,
        "mime": obj.mime,
        "url": url,
        "created_at": obj.created_at.isoformat(),
        "is_default": True,
    }


class UserSignsListCreate(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs_user = SignImage.objects.filter(user=request.user).order_by('-created_at')[:200]
        user_items = [_sign_to_dict(i) for i in qs_user]
        hidden_ids = HiddenDefaultSign.objects.filter(user=request.user).values_list('sign_id', flat=True)
        qs_global = GlobalSignImage.objects.exclude(id__in=hidden_ids).order_by('-created_at')[:200]
        default_items = [_default_sign_to_dict(i) for i in qs_global]
        items = [*user_items, *default_items]
        return Response(items)

    def post(self, request):
        kind = (request.data.get('kind') or 'signature').strip()
        if kind not in ('signature', 'sig_seal', 'round_seal'):
            return Response({'detail': 'kind должен быть signature|sig_seal|round_seal'}, status=400)

        if 'image' in request.FILES:
            f = request.FILES['image']
            data = f.read()
            mime = f.content_type or 'image/png'
        else:
            data_url = (request.data.get('data_url') or '').strip()
            if not data_url.startswith('data:'):
                return Response({'detail': 'Ожидается файл image или data_url'}, status=400)
            try:
                mime = data_url.split(';', 1)[0].split(':', 1)[1] or 'image/png'
                b64 = data_url.split(',', 1)[1]
                data = base64.b64decode(b64)
            except Exception:
                return Response({'detail': 'Некорректный data_url'}, status=400)

        if len(data) > 6 * 1024 * 1024:
            return Response({'detail': 'Изображение слишком большое (до 6 МБ)'}, status=400)

        obj = SignImage.objects.create(user=request.user, kind=kind, mime=mime, data=data)
        return Response(_sign_to_dict(obj), status=201)


class UserSignDetail(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_obj(self, request, pk):
        return SignImage.objects.get(pk=pk, user=request.user)

    def delete(self, request, pk):
        self.get_obj(request, pk).delete()
        return Response(status=204)


# ---------- Глобальные подписи/печати (админ) ----------
class DefaultSignsListCreate(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        qs = GlobalSignImage.objects.all().order_by('-created_at')
        return Response([_default_sign_to_dict(i) for i in qs])

    def post(self, request):
        kind = (request.data.get('kind') or 'signature').strip()
        if kind not in ('signature', 'sig_seal', 'round_seal'):
            return Response({'detail': 'kind должен быть signature|sig_seal|round_seal'}, status=400)

        if 'image' in request.FILES:
            f = request.FILES['image']
            data = f.read()
            mime = f.content_type or 'image/png'
        else:
            data_url = (request.data.get('data_url') or '').strip()
            if not data_url.startswith('data:'):
                return Response({'detail': 'Ожидается файл image или data_url'}, status=400)
            try:
                mime = data_url.split(';', 1)[0].split(':', 1)[1] or 'image/png'
                b64 = data_url.split(',', 1)[1]
                data = base64.b64decode(b64)
            except Exception:
                return Response({'detail': 'Некорректный data_url'}, status=400)

        if len(data) > 6 * 1024 * 1024:
            return Response({'detail': 'Изображение слишком большое (до 6 МБ)'}, status=400)

        obj = GlobalSignImage.objects.create(kind=kind, mime=mime, data=data)
        return Response(_default_sign_to_dict(obj), status=201)


class DefaultSignDetail(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get_obj(self, pk):
        return GlobalSignImage.objects.get(pk=pk)

    def delete(self, request, pk):
        self.get_obj(pk).delete()
        HiddenDefaultSign.objects.filter(sign_id=pk).delete()
        return Response(status=204)


class HideDefaultSignView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        """
        POST body: { "sign_id": <int>, "hide": true|false }
        """
        try:
            sign_id = int(request.data.get('sign_id'))
        except Exception:
            return Response({'detail': 'sign_id обязателен'}, status=400)
        hide = bool(request.data.get('hide') in (True, 'true', '1', 1))

        if not GlobalSignImage.objects.filter(id=sign_id).exists():
            return Response({'detail': 'Объект не найден'}, status=404)

        if hide:
            HiddenDefaultSign.objects.get_or_create(user=request.user, sign_id=sign_id)
        else:
            HiddenDefaultSign.objects.filter(user=request.user, sign_id=sign_id).delete()

        return Response({'ok': True})
    
# ---------- Платежи (заглушка-редирект) ----------
class PaymentCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        plan = (request.data.get('plan') or 'single')
        promo = (request.data.get('promo') or '').strip()
        percent = 0
        if promo:
            pr = PromoCode.objects.filter(code__iexact=promo, active=True).first()
            percent = pr.discount_percent if pr else 0
        url = f'https://example.com/pay?plan={plan}&uid={request.user.id}&discount={percent}'
        return Response({'url': url})


# ---------- История загрузок документов ----------
class UploadRecordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        doc_name = (request.data.get('doc_name') or '').strip()[:200]
        client_id = (request.data.get('client_id') or '').strip()[:64]
        try:
            pages = int(request.data.get('pages') or 0)
        except Exception:
            return Response({'detail': 'pages должен быть числом'}, status=400)

        if not client_id:
            return Response({'detail': 'client_id обязателен'}, status=400)
        if pages <= 0:
            return Response({'detail': 'pages должен быть больше 0'}, status=400)

        ttl_h = _get_ttl_hours()
        auto_delete_at = timezone.now() + timedelta(hours=ttl_h)

        obj = Upload.objects.create(
            user=request.user,
            client_id=client_id,
            doc_name=doc_name,
            pages=pages,
            auto_delete_at=auto_delete_at,
        )
        return Response({
            "id": obj.id,
            "client_id": obj.client_id,
            "doc_name": obj.doc_name,
            "pages": obj.pages,
            "created_at": obj.created_at.isoformat(),
            "auto_delete_at": obj.auto_delete_at.isoformat(),
            "deleted": obj.deleted,
        }, status=201)


class UploadDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        """
        Пометить загрузку как удалённую.
        Принимает либо id, либо client_id. Если указан client_id — помечаем все активные записи пользователя с этим client_id.
        """
        uid = request.data.get('id', None)
        cid = (request.data.get('client_id') or '').strip()

        if not uid and not cid:
            return Response({'detail': 'Требуется id или client_id'}, status=400)

        qs = Upload.objects.filter(user=request.user, deleted=False)
        if uid:
            qs = qs.filter(id=uid)
        if cid:
            qs = qs.filter(client_id=cid)

        now = timezone.now()
        updated = qs.update(deleted=True, deleted_at=now)
        return Response({'updated': int(updated)})


# ---------- Серверное хранилище черновика документа ----------

def _ensure_overlay_ids(page_dict: dict):
    """
    Гарантируем наличие id у каждого overlay для корректной адресации патчами.
    """
    overlays = page_dict.get('overlays') or []
    changed = False
    for idx, o in enumerate(overlays):
        if 'id' not in o or not o['id']:
            o['id'] = f"ov_{int(time.time()*1000)}_{idx}"
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
      - {"op":"page_set_meta", "page": int, "meta": {...}}  # полная замена метаданных страницы (с сохранением overlays/landscape)
      - {"op":"page_add", "index": int, "page": {...}}      # опционально
      - {"op":"page_remove", "index": int}                  # опционально
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
                        oid = f"ov_{int(time.time()*1000)}_{len(ov)}"
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


class DraftGetView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        d = getattr(request.user, 'document_draft', None)
        if not d:
            return Response({"exists": False})
        # Если протух — удаляем и возвращаем отсутствие
        if d.is_expired():
            d.delete()
            return Response({"exists": False})
        # гарантируем id у overlays
        snap = copy.deepcopy(d.data or {})
        for p in (snap.get('pages') or []):
            _ensure_overlay_ids(p)
        return Response({
            "exists": True,
            "updated_at": d.updated_at.isoformat(),
            "expires_at": d.expires_at.isoformat(),
            "data": snap,
        })


class DraftSaveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = request.data.get('data', None)
        if not isinstance(data, dict):
            return Response({'detail': 'Ожидается объект data'}, status=400)
        ttl_h = _get_ttl_hours()
        exp = timezone.now() + timedelta(hours=ttl_h)
        # нормализуем overlays -> наличие id
        snap = copy.deepcopy(data)
        for p in (snap.get('pages') or []):
            _ensure_overlay_ids(p)

        d, _ = DocumentDraft.objects.update_or_create(
            user=request.user,
            defaults={'data': snap, 'expires_at': exp}
        )
        return Response({
            "saved": True,
            "updated_at": d.updated_at.isoformat(),
            "expires_at": d.expires_at.isoformat(),
        })


class DraftPatchView(APIView):
    """
    Применение лёгких патчей к существующему черновику без полной пересылки snapshot.
    body: { "ops": [ {op, ...}, ... ] }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ops = request.data.get('ops')
        if not isinstance(ops, list):
            return Response({'detail': 'Ожидается массив ops'}, status=400)

        d = getattr(request.user, 'document_draft', None)
        if not d:
            return Response({'detail': 'Черновик не найден'}, status=404)

        # TTL продлеваем
        ttl_h = _get_ttl_hours()
        d.expires_at = timezone.now() + timedelta(hours=ttl_h)

        snap = copy.deepcopy(d.data or {})
        if 'pages' not in snap or not isinstance(snap['pages'], list):
            snap['pages'] = []

        new_snap = _apply_patch_ops(snap, ops)

        d.data = new_snap
        d.save(update_fields=['data', 'expires_at', 'updated_at'])

        return Response({
            "patched": True,
            "updated_at": d.updated_at.isoformat(),
            "expires_at": d.expires_at.isoformat(),
        })


class DraftClearView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        d = getattr(request.user, 'document_draft', None)
        if d:
            d.delete()
        return Response({"ok": True})


# ---------- SPA (React) ----------
from django.views.generic import TemplateView


class ReactAppView(TemplateView):
    template_name = 'index.html'