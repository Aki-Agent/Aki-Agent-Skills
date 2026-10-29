# Aki Agent Skills

Colección de skills para [Aki Agent](https://aki.ar): instrucciones reutilizables que un agente carga para resolver tareas concretas de forma reproducible.

Cada skill es una carpeta autocontenida con un `SKILL.md` (frontmatter + instrucciones) y los scripts que usa. Sin API keys, sin servicios de pago: lo que necesita se instala y corre localmente.

## Skills disponibles

| Skill | Qué hace | Estado |
|---|---|---|
| [youtube-transcriber](skills/youtube-transcriber/) | Descarga el audio de un video de YouTube y genera transcripción con timestamps: `.txt`, `.md`, `.json` y `.srt` | estable |

## Estructura del repo

```
.
├── README.md
├── skills/
│   └── <nombre-de-la-skill>/
│       ├── SKILL.md        # frontmatter (name, description) + instrucciones
│       └── scripts/        # código que ejecuta la skill
└── .gitignore
```

## Cómo usar una skill

1. Copiá (o cloná) la carpeta de la skill en tu directorio de skills del agente.
2. El agente la descubre por el `name`/`description` del frontmatter de `SKILL.md`.
3. Las dependencias se instalan dentro del script (bootstrap idempotente), así que no hace falta preparar el entorno antes.

Para probarla a mano, seguí el ejemplo de **Prueba rápida** dentro de cada `SKILL.md`.

## Cómo agregar una nueva skill

1. Creá `skills/<nombre>/SKILL.md` con frontmatter:

   ```yaml
   ---
   name: nombre-de-la-skill
   description: Qué hace y cuándo usarla, en una o dos frases.
   ---
   ```

2. Poné el código en `skills/<nombre>/scripts/` y hacé que el propio script resuelva sus dependencias.
3. Documentá uso, flags, tiempos medidos y límites reales (no estimaciones inventadas).
4. Agregá la skill a la tabla de arriba.
5. Verificá que el script corra de punta a punta antes de commitear.

### Convenciones

- **Idempotencia:** asumí que el entorno puede recrearse y perder lo instalado. El script debe poder correr dos veces seguidas sin romperse.
- **Rutas persistentes:** cacheá modelos y artefactos intermedios en un directorio persistente, no en `/tmp`.
- **Errores honestos:** si algo falla, reportá el error real de la herramienta; nunca un resultado inventado.
- **Sin datos sensibles:** ni credenciales, ni tokens, ni datos personales, ni rutas con nombres de usuario en el código o en los ejemplos.
- **Salida útil:** texto plano + versión estructurada (JSON) para que otro paso pueda consumirla.

## Requisitos

- Python 3.10+
- `ffmpeg` (lo usan las skills que procesan audio/video)
- Acceso a red para instalar dependencias la primera vez

## Nota de privacidad

Este repositorio es público. Los ejemplos usan placeholders (`<ID_DEL_VIDEO>`) en lugar de contenido real de terceros. Si contribuís, revisá tu diff antes de subirlo: nada de IDs de videos privados, credenciales, rutas personales ni transcripciones con datos de personas.

## Licencia

Sin licencia definida todavía. Mientras no haya una, el contenido no puede reutilizarse fuera de este repositorio.
