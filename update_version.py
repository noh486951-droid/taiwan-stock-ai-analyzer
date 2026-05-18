import os
import re

def update_version(directory, new_ver_number):
    # Regex to find 11.x.x or 11.x (with or without 'v' prefix)
    pattern = re.compile(r'11\.[0-9]+(\.[0-9]+)?')
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.html'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    enc = 'utf-8'
                except UnicodeDecodeError:
                    try:
                        with open(path, 'r', encoding='cp950') as f:
                            content = f.read()
                        enc = 'cp950'
                    except:
                        continue
                
                new_content = pattern.sub(new_ver_number, content)
                
                if new_content != content:
                    with open(path, 'w', encoding=enc) as f:
                        f.write(new_content)
                    print(f"Updated {path} to {new_ver_number} ({enc})")

if __name__ == "__main__":
    update_version('.', '11.14.11')
