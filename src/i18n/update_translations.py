import json
from pathlib import Path

LOCALES_DIR = Path("./locales")

TRANSLATIONS = {
    "de": {
        "name": "Alphabetisch",
        "created": "Erstellungsdatum",
        "modified": "Änderungsdatum",
        "imageCount": "Bildanzahl",
        "sortFolders": "Ordner sortieren"
    },
    "en": {
        "name": "Alphabetically",
        "created": "Date Created",
        "modified": "Date Modified",
        "imageCount": "Image Count",
        "sortFolders": "Sort Folders"
    },
    "es": {
        "name": "Alfabéticamente",
        "created": "Fecha de creación",
        "modified": "Fecha de modificación",
        "imageCount": "Recuento de imágenes",
        "sortFolders": "Ordenar carpetas"
    },
    "fr": {
        "name": "Alphabétique",
        "created": "Date de création",
        "modified": "Date de modification",
        "imageCount": "Nombre d'images",
        "sortFolders": "Trier les dossiers"
    },
    "it": {
        "name": "In ordine alfabetico",
        "created": "Data di creazione",
        "modified": "Data di modifica",
        "imageCount": "Conteggio immagini",
        "sortFolders": "Ordina cartelle"
    },
    "ja": {
        "name": "アルファベット順",
        "created": "作成日",
        "modified": "更新日",
        "imageCount": "画像数",
        "sortFolders": "フォルダーを並べ替え"
    },
    "ko": {
        "name": "알파벳순",
        "created": "생성일",
        "modified": "수정일",
        "imageCount": "이미지 수",
        "sortFolders": "폴더 정렬"
    },
    "pl": {
        "name": "Alfabetycznie",
        "created": "Data utworzenia",
        "modified": "Data modyfikacji",
        "imageCount": "Liczba obrazów",
        "sortFolders": "Sortuj foldery"
    },
    "pt": {
        "name": "Alfabeticamente",
        "created": "Data de criação",
        "modified": "Data de modificação",
        "imageCount": "Contagem de imagens",
        "sortFolders": "Ordenar pastas"
    },
    "ru": {
        "name": "По алфавиту",
        "created": "Дата создания",
        "modified": "Дата изменения",
        "imageCount": "Количество изображений",
        "sortFolders": "Сортировать папки"
    },
    "zh-CN": {
        "name": "按字母顺序",
        "created": "创建日期",
        "modified": "修改日期",
        "imageCount": "图像数量",
        "sortFolders": "对文件夹排序"
    },
    "zh-TW": {
        "name": "按字母順序",
        "created": "建立日期",
        "modified": "修改日期",
        "imageCount": "影像數量",
        "sortFolders": "對資料夾排序"
    }
}

def sort_dict_recursively(item):
    """Recursively sorts dictionary keys alphabetically."""
    if isinstance(item, dict):
        return {k: sort_dict_recursively(v) for k, v in sorted(item.items())}
    elif isinstance(item, list):
        return [sort_dict_recursively(x) for x in item]
    return item

def update_json_file(file_path: Path, trans: dict):
    if not file_path.exists():
        print(f"Skipping: {file_path.name} (File not found)")
        return

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        print(f"Error parsing JSON in {file_path.name}. Skipping.")
        return

    if "library" not in data or not isinstance(data["library"], dict):
        data["library"] = {}
    if "folders" not in data["library"] or not isinstance(data["library"]["folders"], dict):
        data["library"]["folders"] = {}

    folders = data["library"]["folders"]

    if "sort" not in folders or not isinstance(folders["sort"], dict):
        folders["sort"] = {}
    if "tooltips" not in folders or not isinstance(folders["tooltips"], dict):
        folders["tooltips"] = {}

    folders["sort"]["name"] = trans["name"]
    folders["sort"]["created"] = trans["created"]
    folders["sort"]["modified"] = trans["modified"]
    folders["sort"]["imageCount"] = trans["imageCount"]

    folders["tooltips"]["sortFolders"] = trans["sortFolders"]

    sorted_data = sort_dict_recursively(data)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated and Sorted: {file_path.name}")

def main():
    if not LOCALES_DIR.exists():
        print(f"Error: Locales directory '{LOCALES_DIR}' does not exist.")
        return

    print("Starting sorted translation updates...")
    for lang, trans in TRANSLATIONS.items():
        file_path = LOCALES_DIR / f"{lang}.json"
        update_json_file(file_path, trans)
    print("Done!")

if __name__ == "__main__":
    main()
