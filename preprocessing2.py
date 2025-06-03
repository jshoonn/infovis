import re

with open('src/data/tsne_data.json', 'r', encoding='utf-8') as f:
    text = f.read()

fixed_text = re.sub(r':\s*NaN', ': null', text)

with open('src/data/tsne_data.json', 'w', encoding='utf-8') as f:
    f.write(fixed_text)

print("tsne_data.json 의 NaN을 0으로 모두 교체했습니다.")
