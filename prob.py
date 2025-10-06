import os

def print_project_structure(path, file, indent=0):
    try:
        entries = os.listdir(path)
        entries.sort()  # Сортируем для более предсказуемого вывода

        for index, entry in enumerate(entries):
            full_path = os.path.join(path, entry)
            if entry in ['__pycache__', '.git']:
                continue

            # Определяем символы для отображения вложенности
            connector = '├── ' if index < len(entries) - 1 else '└── '
            file.write('    ' * indent + connector + entry + '\n')

            if os.path.isdir(full_path):
                print_project_structure(full_path, file, indent + 1)
    except PermissionError:
        file.write('    ' * indent + '└── [Permission denied]\n')

if __name__ == "__main__":
    project_path = 'D:/Max/ScannyRF'  # Укажите путь к папке с проектом
    output_file = 'project_structure.txt'  # Имя выходного файла

    with open(output_file, 'w', encoding='utf-8') as file:
        print_project_structure(project_path, file)

    print(f"Структура проекта сохранена в '{output_file}'")