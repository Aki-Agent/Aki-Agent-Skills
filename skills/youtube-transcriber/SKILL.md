---
name: youtube-transcriber
description: Descarga el audio de un video de YouTube y genera su transcripcion completa con marcas de tiempo. Usar cuando el usuario pida transcribir, subtitular, extraer el texto, resumir o analizar el contenido hablado de un video de YouTube (o de una lista de videos), incluso si no hay subtitulos disponibles.
---

# YouTube Transcriber

Convierte un video de YouTube en texto util: transcripcion con timestamps, SRT y Markdown.

Sigue el formato `SKILL.md` + `scripts/` (Aki Agent Studio / Claude). No requiere API keys ni servicios de pago: usa `yt-dlp` y `faster-whisper` locales.

## Cuando usar esta skill

- "transcribi este video", "pasame el texto de este video"
- "resumime esta charla / este podcast de YouTube"
- "necesito los subtitulos en .srt"
- Analisis de contenido: encontrar citas, afirmaciones, minutos exactos.

No la uses para: descargar video en calidad alta (esto extrae solo audio), ni para plataformas distintas de YouTube sin adaptar `yt-dlp`.

## Estrategia (importante)

1. **Primero subtitulos** (`--subs`): si el video tiene subtitulos manuales o automaticos, se obtienen en segundos y con puntuacion correcta. Es el camino preferido.
2. **Fallback Whisper local** (`faster-whisper`, CPU): si no hay subtitulos, o si estan bloqueados (HTTP 429), o el usuario necesita el audio real.
3. Un `HTTP 429` de YouTube suele ser transitorio: reintentar una vez antes de pasar a Whisper.

## Uso

```bash
python3 scripts/yt_transcribe.py "<url o id>" --subs --lang es
```

Salidas en `/workspace/yt-transcripts/`: `.txt` (parrafos con `[hh:mm]`), `.md` (metadata + capitulos + transcripcion), `.json` (segmentos con start/end), y `.srt` con `--srt`.

### Prueba rapida

```bash
python3 scripts/yt_transcribe.py "https://www.youtube.com/watch?v=<ID_DEL_VIDEO>" --subs --lang es --srt
```

Deberia terminar con `LISTO -> .../archivo.txt (N segmentos, fuente: ...)`.

### Parametros

| Flag | Para que |
|---|---|
| `--subs` | intenta subtitulos de YouTube primero (muy recomendado) |
| `--model base\|small\|medium` | calidad de Whisper. `base` = rapido (~0.26x tiempo real), `small` = mejor, `medium` = maximo (lento en CPU) |
| `--lang es` | fija idioma y evita autodeteccion erronea. Omitilo para autodetectar |
| `--range 0-600` | transcribe solo un tramo (segundos). Util para videos largos |
| `--srt` | genera ademas subtitulos `.srt` |
| `-o ruta/sin_extension` | nombre de salida |
| `--outdir DIR` | carpeta de salida |

### Videos largos

Whisper en CPU corre a ~4x tiempo real con `base`: 1 hora de video ≈ 15 min de proceso. Para videos de mas de ~20 min:

1. Correr por tramos con `--range` y concatenar, o
2. Preferir `--subs` (instantaneo), o
3. Avisar al usuario del tiempo estimado antes de empezar.

## Setup (idempotente)

El script hace bootstrap solo. Si hace falta manualmente:

```bash
pip install --break-system-packages yt-dlp faster-whisper "av==12.3.0"
```

- `av==12.3.0` es requisito: `av>=13` rompe `faster-whisper` (`metadata_errors`).
- El sandbox puede recrearse y perder los `pip install`; volver a correr el script lo resuelve.
- El modelo de Whisper se cachea en `/workspace/.cache/whisper` (persistente). La primera descarga de `base` es ~140 MB.

## Despues de transcribir

1. Leer el `.txt` o `.md` generado (no inventar contenido).
2. Si el usuario pidio resumen o analisis: trabajar sobre ese texto y citar timestamps (`[12:34]`).
3. Entregar el archivo con la tool de descarga si lo pide; si no, mostrar el resumen en el chat.

## Notas y limites

- Solo contenido publico o no listado. Videos privados, con restriccion de edad o con DRM pueden fallar: informar el error real de `yt-dlp`.
- Respetar derechos de autor: transcribir para analisis personal, no para redistribuir el contenido integro.
- Si `faster-whisper` no puede descargar el modelo por limite del entorno, usar `--subs` o `--model tiny`.
