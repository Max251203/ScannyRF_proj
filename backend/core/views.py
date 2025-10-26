import time
import base64
from datetime import timedelta

import requests
from django.utils import timezone
from django.db.models import Sum
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
    cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={'free_daily_quota': 3})
    return int(cfg.free_daily_quota or 0)


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
    history = Operation.objects.filter(user=user).values('id', 'kind', 'pages', 'doc_name', 'free', 'created_at')[:50]

    return {
        "free_total": free_total,
        "free_used": int(free_used),
        "free_left": free_left,
        "reset_at": (start + timedelta(days=1)).isoformat(),
        "subscription": ({
            "plan": sub.plan,
            "expires_at": sub.expires_at.isoformat()
        } if sub else None),
        "history": list(history),
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


# ---------- Конфигурация биллинга (админ) ----------
class BillingConfigView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={'free_daily_quota': 3})
        return Response({"free_daily_quota": cfg.free_daily_quota})

    def put(self, request):
        try:
            val = int(request.data.get('free_daily_quota'))
            if val < 0:
                raise ValueError
        except Exception:
            return Response({'detail': 'free_daily_quota должен быть неотрицательным числом'}, status=400)
        cfg, _ = BillingConfig.objects.get_or_create(pk=1, defaults={'free_daily_quota': 3})
        cfg.free_daily_quota = val
        cfg.save()
        return Response({"free_daily_quota": cfg.free_daily_quota})


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
        # Пользовательские
        qs_user = SignImage.objects.filter(user=request.user).order_by('-created_at')[:200]
        user_items = [_sign_to_dict(i) for i in qs_user]
        # Глобальные (за исключением скрытых пользователем)
        hidden_ids = HiddenDefaultSign.objects.filter(user=request.user).values_list('sign_id', flat=True)
        qs_global = GlobalSignImage.objects.exclude(id__in=hidden_ids).order_by('-created_at')[:200]
        default_items = [_default_sign_to_dict(i) for i in qs_global]
        # Объединяем: приоритет пользовательских
        items = [*user_items, *default_items]
        return Response(items)

    def post(self, request):
        kind = (request.data.get('kind') or 'signature').strip()
        if kind not in ('signature', 'sig_seal', 'round_seal'):
            return Response({'detail': 'kind должен быть signature|sig_seal|round_seal'}, status=400)

        # Файл или data URL
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
        # Также удаляем скрытия этого объекта у пользователей
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


# backend/core/views.py (в конец файла)
from django.views.generic import TemplateView


class ReactAppView(TemplateView):
    template_name = 'index.html'