import os
import re

def process_file(filepath, css_path):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace the <style>...</style> block with the link tag
    # Uses re.DOTALL to match newlines inside the style block
    pattern = re.compile(r'<style>.*?</style>', re.DOTALL)
    link_tag = f'<link rel="stylesheet" href="{css_path}">'
    
    new_content, count = pattern.subn(link_tag, content)
    
    if count > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

docs_dir = 'docs'
for filename in os.listdir(docs_dir):
    if filename.endswith('.html') and filename != 'index.html':
        process_file(os.path.join(docs_dir, filename), 'global.css')

zh_dir = os.path.join(docs_dir, 'zh')
if os.path.exists(zh_dir):
    for filename in os.listdir(zh_dir):
        if filename.endswith('.html') and filename != 'index.html':
            process_file(os.path.join(zh_dir, filename), '../global.css')
