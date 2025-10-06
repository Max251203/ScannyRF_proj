import time
from datetime import timedelta

import requests
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Subscription, Operation

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


# ---------- Биллинг / история ----------
def _billing_status(user):
    tz = timezone.get_default_timezone()
    now = timezone.now().astimezone(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)  # полночь локальной TZ

    free_total = 3  # ← повышено до 3 в сутки
    free_used = Operation.objects.filter(user=user, free=True, created_at__gte=start).count()
    free_left = max(0, free_total - free_used)

    sub = Subscription.objects.filter(user=user, expires_at__gt=timezone.now()).order_by('-expires_at').first()
    history = Operation.objects.filter(user=user).values('id', 'kind', 'pages', 'doc_name', 'free', 'created_at')[:50]

    return {
        "free_total": free_total,
        "free_used": free_used,
        "free_left": free_left,
        "reset_at": (start + timedelta(days=1)).isoformat(),
        "subscription": ({
            "plan": sub.plan,
            "expires_at": sub.expires_at.isoformat()
        } if sub else None),
        "history": list(history),
    }


class BillingStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_billing_status(request.user))


class BillingRecordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        kind = (request.data.get('kind') or '').lower()  # 'jpg' | 'pdf'
        pages = int(request.data.get('pages') or 1)
        mode = (request.data.get('mode') or 'free').lower()  # 'free'|'paid'
        doc_name = (request.data.get('doc_name') or '')[:200]

        if kind not in ('jpg', 'pdf'):
            return Response({'detail': 'kind должен быть jpg|pdf'}, status=400)

        has_sub = Subscription.objects.filter(user=request.user, expires_at__gt=timezone.now()).exists()
        if mode == 'free' and not has_sub:
            st = _billing_status(request.user)
            if st['free_left'] <= 0:
                return Response({'detail': 'Лимит бесплатных скачиваний на сегодня исчерпан'}, status=403)

        Operation.objects.create(
            user=request.user,
            kind=f'download_{kind}',
            pages=max(1, pages),
            doc_name=doc_name,
            free=(mode == 'free'),
        )
        return Response(_billing_status(request.user))


class PaymentCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        plan = (request.data.get('plan') or 'single')
        url = f'https://example.com/pay?plan={plan}&uid={request.user.id}'
        return Response({'url': url})
    
# backend/core/views.py (в конец файла)
from django.views.generic import TemplateView

class ReactAppView(TemplateView):
    template_name = 'index.html'