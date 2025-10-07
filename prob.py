# import os

# def print_project_structure(path, file, indent=0):
#     try:
#         entries = os.listdir(path)
#         entries.sort()  # Сортируем для более предсказуемого вывода

#         for index, entry in enumerate(entries):
#             full_path = os.path.join(path, entry)
#             if entry in ['__pycache__', '.git']:
#                 continue

#             # Определяем символы для отображения вложенности
#             connector = '├── ' if index < len(entries) - 1 else '└── '
#             file.write('    ' * indent + connector + entry + '\n')

#             if os.path.isdir(full_path):
#                 print_project_structure(full_path, file, indent + 1)
#     except PermissionError:
#         file.write('    ' * indent + '└── [Permission denied]\n')

# if __name__ == "__main__":
#     project_path = 'D:/Max/ScannyRF'  # Укажите путь к папке с проектом
#     output_file = 'project_structure.txt'  # Имя выходного файла

#     with open(output_file, 'w', encoding='utf-8') as file:
#         print_project_structure(project_path, file)

#     print(f"Структура проекта сохранена в '{output_file}'")

from django.core.mail import send_mail
from django.conf import settings

print("--- Настройки почты ---")
print(f"HOST: {settings.EMAIL_HOST}")
print(f"PORT: {settings.EMAIL_PORT}")
print(f"USER: {settings.EMAIL_HOST_USER}")
print(f"USE_TLS: {settings.EMAIL_USE_TLS}")
print("-----------------------")

try:
    print("Попытка отправить тестовое письмо...")
    sent_count = send_mail(
        'Тест SMTP с сервера OnRender',
        'Если вы получили это письмо, значит, настройки SMTP верны.',
        settings.DEFAULT_FROM_EMAIL,
        ['ваш_тестовый_email@gmail.com'],  # <--- ЗАМЕНИТЕ НА ВАШУ РЕАЛЬНУЮ ПОЧТУ
        fail_silently=False
    )
    if sent_count > 0:
        print("\nУСПЕХ! Письмо отправлено. Проверьте ваш ящик.")
    else:
        print("\nНЕУДАЧА! Функция send_mail не вернула ошибку, но ничего не отправила.")
except Exception as e:
    print("\n!!! ПРОИЗОШЛА ОШИБКА !!!")
    import traceback
    traceback.print_exc()