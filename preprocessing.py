import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.manifold import TSNE
import json


df = pd.read_csv('src/data/spotify_dataset.csv')


df.rename(columns={
    'Artist(s)':      'artist',
    'song':           'title',
    'text':           'lyrics',
    'Length':         'length',
    'emotion':        'emotion',
    'Genre':          'genre',
    'Album':          'album',
    'Release Date':   'release_date',
    'Key':            'key',
    'Tempo':          'tempo'
}, inplace=True)


df = df.dropna(subset=['lyrics'])
df_sample = df.sample(n=20000, random_state=42)


model = SentenceTransformer('all-mpnet-base-v2')
embeddings = model.encode(
    df_sample['lyrics'].tolist(),
    batch_size=64,
    show_progress_bar=True
)


tsne = TSNE(n_components=2, perplexity=30, n_iter=1000, random_state=42)
coords = tsne.fit_transform(embeddings)


output = []
for i, row in df_sample.reset_index(drop=True).iterrows():
    output.append({
        'artist':         row.get('artist', ''),
        'title':          row.get('title', ''),
        'album':          row.get('album', ''),
        'release_date':   row.get('release_date', ''),
        'key':            row.get('key', ''),
        'tempo':          row.get('tempo', 0),
        'length':         row.get('length', ''),
        'x':              float(coords[i, 0]),
        'y':              float(coords[i, 1]),
        'genre':          row.get('genre', ''),
        'emotion':        row.get('emotion', ''),
        'lyrics_excerpt': row['lyrics'][:200]
    })

with open('src/data/tsne_data.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("생성 완료")
