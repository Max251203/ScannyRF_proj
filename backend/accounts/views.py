import os
import random
import requests
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError
from django.contrib.auth import get_user_model

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.exceptions import InvalidToken

from google.oauth2 import id_token
from google.auth.transport import requests as greq

from .models import User, PasswordResetCode
from .serializers import (
    RegisterSerializer, LoginSerializer, UserSerializer, ProfileUpdateSerializer
)


def tokens_for_user(user):
    ref = RefreshToken.for_user(user)
    return {'access': str(ref.access_token), 'refresh': str(ref)}


def ensure_username(base):
    base = (base or 'user').split('@')[0]
    u, i = base, 0
    while User.objects.filter(username=u).exists():
        i += 1
        u = f"{base}{i}"
    return u


class ApiRootView(APIView):
    permission_classes = [permissions.AllowAny]
    def get(self, request):
        base = request.build_absolute_uri('/api/')
        return Response({
            "status": "ok",
            "endpoints": {
                "register":  base + "auth/register/",
                "login":     base + "auth/login/",
                "me":        base + "auth/me/",
                "profile":   base + "auth/profile/",
                "pwd_code":  base + "auth/password/request-code/",
                "pwd_confirm": base + "auth/password/confirm/",
                "google":    base + "auth/google/",
                "facebook":  base + "auth/facebook/",
                "vk":        base + "auth/vk/",
                "users_admin": base + "admin/users/",
                "faq":       base + "cms/faq/",
                "legal":     base + "cms/legal/",
            }
        })


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        s = RegisterSerializer(data=request.data); s.is_valid(raise_exception=True)
        email = s.validated_data['email'].lower()
        username = s.validated_data.get('username') or ensure_username(email)
        password = s.validated_data['password']
        if User.objects.filter(Q(email__iexact=email)|Q(username__iexact=username)).exists():
            return Response({'detail':'Пользователь с таким email/логином уже существует'}, status=400)
        user = User.objects.create(username=username, email=email)
        user.set_password(password); user.save()
        return Response({'user': UserSerializer(user).data, **tokens_for_user(user)}, status=201)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        s = LoginSerializer(data=request.data); s.is_valid(raise_exception=True)
        ident = s.validated_data['identifier']; password = s.validated_data['password']
        user = User.objects.filter(email__iexact=ident).first() if '@' in ident else None
        if not user: user = User.objects.filter(username__iexact=ident).first()
        if not user or not user.check_password(password):
            return Response({'detail':'Неверные учетные данные'}, status=400)
        return Response({'user': UserSerializer(user).data, **tokens_for_user(user)})


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ProfileUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request):
        s = ProfileUpdateSerializer(data=request.data); s.is_valid(raise_exception=True)
        u = request.user

        if s.validated_data.get('email'):
            new_email = s.validated_data['email'].strip().lower()
            if User.objects.exclude(pk=u.pk).filter(email__iexact=new_email).exists():
                return Response({'detail': 'Этот e‑mail уже занят'}, status=400)
            u.email = new_email

        if 'username' in s.validated_data:
            new_username = (s.validated_data.get('username') or '').strip()
            if new_username and User.objects.exclude(pk=u.pk).filter(username__iexact=new_username).exists():
                return Response({'detail': 'Логин уже занят'}, status=400)
            u.username = new_username

        if s.validated_data.get('remove_avatar'):
            u.avatar_bin = None; u.avatar_mime = None
        if 'avatar' in request.FILES:
            f = request.FILES['avatar']; u.avatar_bin = f.read(); u.avatar_mime = f.content_type or 'image/png'

        try:
            u.save()
        except IntegrityError:
            return Response({'detail': 'Нарушение уникальности email/логина'}, status=400)

        return Response(UserSerializer(u).data)


class RequestResetCodeView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return Response({'detail':'Укажите e‑mail'}, status=400)
        u = User.objects.filter(email__iexact=email).first()
        if not u:
            return Response({'detail':'Пользователь не найден'}, status=404)

        last = PasswordResetCode.objects.filter(user=u, used=False).order_by('-created_at').first()
        if last and (timezone.now() - last.created_at) < timedelta(seconds=60):
            code = last.code
        else:
            code = f"{random.randint(0,999999):06d}"
            PasswordResetCode.objects.create(user=u, code=code)

        subject = 'Код для смены пароля — Сканни.рф'
        from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'no-reply@scannyrf')
        site_name = 'Сканни.рф'
        text = (
            f'Здравствуйте!\n\n'
            f'Ваш код подтверждения: {code}\n'
            f'Код действителен 15 минут.\n\n'
            f'Если вы не запрашивали смену пароля на {site_name}, просто проигнорируйте это письмо.'
        )
        html = f"""
        <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.5;">
          <p>Здравствуйте!</p>
          <p>Ваш код подтверждения:</p>
          <p style="font-size:22px;font-weight:800;letter-spacing:2px;">{code}</p>
          <p>Код действителен 15 минут.</p>
          <p style="color:#666">Если вы не запрашивали смену пароля на {site_name}, просто проигнорируйте это письмо.</p>
        </div>
        """
        try:
            msg = EmailMultiAlternatives(subject, text, from_email, [email])
            msg.attach_alternative(html, "text/html")
            msg.send(fail_silently=False)
            return Response({'ok': True})
        except Exception as e:
            return Response({'detail': f'Не удалось отправить письмо: {e}'}, status=500)


class ConfirmResetCodeView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        code = (request.data.get('code') or '').strip()
        new_password = (request.data.get('new_password') or '').strip()
        if not email or not code or not new_password:
            return Response({'detail':'Укажите email, код и новый пароль'}, status=400)
        if len(code)!=6 or not code.isdigit():
            return Response({'detail':'Код должен состоять из 6 цифр'}, status=400)
        if len(new_password)<6:
            return Response({'detail':'Пароль должен быть не менее 6 символов'}, status=400)

        u = User.objects.filter(email__iexact=email).first()
        if not u: return Response({'detail':'Пользователь не найден'}, status=404)
        rec = PasswordResetCode.objects.filter(user=u, code=code, used=False).order_by('-created_at').first()
        if not rec or not rec.is_valid(): return Response({'detail':'Код недействителен'}, status=400)

        rec.used = True; rec.save()
        u.set_password(new_password); u.save()
        return Response({'ok': True, **tokens_for_user(u)})


# Быстрые входы — теперь читаем ключи/секреты из settings, а не os.getenv
class GoogleAuthView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        token = request.data.get('id_token')
        client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
        if not token or not client_id:
            return Response({'detail':'Отсутствуют данные Google'}, status=400)
        try:
            info = id_token.verify_oauth2_token(token, greq.Request(), client_id)
            email = (info.get('email') or '').lower(); name = info.get('name') or ''
            if not email: return Response({'detail':'Не удалось подтвердить email Google'}, status=400)
            u = User.objects.filter(email__iexact=email).first()
            if not u: u = User.objects.create(username=ensure_username(email or name), email=email); u.set_unusable_password(); u.save()
            return Response({'user': UserSerializer(u).data, **tokens_for_user(u)})
        except Exception:
            return Response({'detail':'Идентификатор Google недействителен'}, status=400)


class FacebookAuthView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        token = request.data.get('access_token')
        app_id = getattr(settings, 'FACEBOOK_APP_ID', '')
        app_secret = getattr(settings, 'FACEBOOK_APP_SECRET', '')
        if not token or not app_id or not app_secret:
            return Response({'detail':'Отсутствуют параметры Facebook'}, status=400)
        try:
            dbg = requests.get("https://graph.facebook.com/debug_token",
                               params={'input_token':token,'access_token':f"{app_id}|{app_secret}"}, timeout=10).json()
            if not dbg.get('data',{}).get('is_valid'): return Response({'detail':'Токен Facebook недействителен'}, status=400)
            me = requests.get("https://graph.facebook.com/me",
                              params={'fields':'id,name,email','access_token':token}, timeout=10).json()
            fid = me.get('id'); name = me.get('name') or ''; email = (me.get('email') or f'fb_{fid}@facebook.local').lower()
            if not fid: return Response({'detail':'Не удалось получить профиль Facebook'}, status=400)
            u = User.objects.filter(email__iexact=email).first()
            if not u: u = User.objects.create(username=ensure_username(name or email), email=email); u.set_unusable_password(); u.save()
            return Response({'user': UserSerializer(u).data, **tokens_for_user(u)})
        except Exception:
            return Response({'detail':'Ошибка Facebook'}, status=400)


class VkAuthView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        token = request.data.get('access_token'); email = (request.data.get('email') or '').lower()
        if not token: return Response({'detail':'Нет access_token VK'}, status=400)
        try:
            resp = requests.get('https://api.vk.com/method/users.get',
                                params={'access_token':token,'v':'5.131','fields':'first_name,last_name'}, timeout=10).json()
            if 'error' in resp: return Response({'detail':'Токен VK недействителен'}, status=400)
            info = (resp.get('response') or [{}])[0]
            vid = info.get('id'); first = info.get('first_name',''); last = info.get('last_name','')
            if not vid: return Response({'detail':'Не удалось получить профиль VK'}, status=400)
            if not email: email = f'vk_{vid}@vk.local'
            name = f"{first} {last}".strip()
            u = User.objects.filter(email__iexact=email).first()
            if not u: u = User.objects.create(username=ensure_username(name or email), email=email); u.set_unusable_password(); u.save()
            return Response({'user': UserSerializer(u).data, **tokens_for_user(u)})
        except Exception:
            return Response({'detail':'Ошибка VK'}, status=400)


# Админ — CRUD пользователей
class AdminUsersListCreate(APIView):
    permission_classes = [permissions.IsAdminUser]
    def get(self, request):
        qs = User.objects.all().order_by('id')
        return Response([UserSerializer(u).data for u in qs])

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        username = (request.data.get('username') or '').strip() or ensure_username(email)
        password = request.data.get('password') or ''
        if not email:
            return Response({'detail':'email обязателен'}, status=400)

        if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=username)).exists():
            return Response({'detail':'Пользователь уже существует (email или логин)'}, status=400)

        u = User.objects.create(username=username, email=email, is_staff=False)
        if password: u.set_password(password)
        else: u.set_unusable_password()

        if request.data.get('remove_avatar'):
            u.avatar_bin = None; u.avatar_mime = None
        elif 'avatar' in request.FILES:
            f = request.FILES['avatar']; u.avatar_bin = f.read(); u.avatar_mime = f.content_type or 'image/png'

        try:
            u.save()
        except IntegrityError:
            return Response({'detail':'Нарушение уникальности email/логина'}, status=400)

        return Response(UserSerializer(u).data, status=201)


class AdminUserDetail(APIView):
    permission_classes = [permissions.IsAdminUser]
    def get_obj(self, pk):
        return User.objects.get(pk=pk)
    def get(self, request, pk):
        return Response(UserSerializer(self.get_obj(pk)).data)
    def put(self, request, pk):
        u = self.get_obj(pk)
        email = (request.data.get('email') or u.email).strip().lower()
        username = (request.data.get('username') or '').strip()

        if User.objects.exclude(pk=u.pk).filter(Q(email__iexact=email) | Q(username__iexact=username)).exists():
            return Response({'detail':'email/логин заняты'}, status=400)

        u.email = email
        u.username = username
        if request.data.get('password'):
            u.set_password(request.data['password'])

        if request.data.get('remove_avatar'):
            u.avatar_bin = None; u.avatar_mime = None
        elif 'avatar' in request.FILES:
            f = request.FILES['avatar']; u.avatar_bin = f.read(); u.avatar_mime = f.content_type or 'image/png'

        try:
            u.save()
        except IntegrityError:
            return Response({'detail':'Нарушение уникальности email/логина'}, status=400)

        return Response(UserSerializer(u).data)
    def delete(self, request, pk):
        if request.user and request.user.pk == int(pk):
            return Response({'detail':'Нельзя удалить свой аккаунт'}, status=400)
        self.get_obj(pk).delete()
        return Response(status=204)


class PasswordChangeView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request):
        old_pwd = request.data.get('old_password') or ''
        new_pwd = request.data.get('new_password') or ''
        if not old_pwd or not new_pwd:
            return Response({'detail':'Укажите старый и новый пароль'}, status=400)
        if len(new_pwd) < 6:
            return Response({'detail':'Пароль должен быть не менее 6 символов'}, status=400)
        u = request.user
        if not u.check_password(old_pwd):
            return Response({'detail':'Неверный старый пароль'}, status=400)
        u.set_password(new_pwd); u.save()
        return Response({'ok': True, **tokens_for_user(u)})


# ----- Безопасный refresh-токена (устраняем 500 при отсутствии пользователя) -----
class SafeTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except get_user_model().DoesNotExist:
            # Превращаем в ожидаемую ошибку simplejwt
            raise InvalidToken("User for this token does not exist")


class SafeTokenRefreshView(TokenRefreshView):
    serializer_class = SafeTokenRefreshSerializer