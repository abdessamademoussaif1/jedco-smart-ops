<div align="center">

<img src="docs/assets/banner.png" alt="retrocommit: rellena los huecos de tu gráfica de contribuciones de GitHub" width="100%">

# retrocommit

**Rellena los huecos de tu gráfica de contribuciones de GitHub, directamente desde tu terminal.**

Commits con fechas pasadas y totalmente configurables: rangos de fechas, cantidades fijas o
aleatorias, días de la semana, franjas horarias, modo "solo los días vacíos" e incluso texto
dibujado en tu gráfica. Un solo comando crea el repositorio y lo sube.

[![npm version](https://img.shields.io/npm/v/retrocommit?color=2ea44f&label=npm)](https://www.npmjs.com/package/retrocommit)
[![npm downloads](https://img.shields.io/npm/dm/retrocommit?color=2ea44f)](https://www.npmjs.com/package/retrocommit)
[![CI](https://github.com/abpineda/retrocommit/actions/workflows/ci.yml/badge.svg)](https://github.com/abpineda/retrocommit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/retrocommit?color=2ea44f)](https://nodejs.org)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-2ea44f)](LICENSE)
[![PRs bienvenidos](https://img.shields.io/badge/PRs-bienvenidos-2ea44f)](CONTRIBUTING.md)

[English](README.md) · **Español**

<img src="docs/assets/demo.gif" alt="retrocommit funcionando en una terminal" width="780">

</div>

---

## Contenido

- [¿Por qué retrocommit?](#por-qué-retrocommit)
- [Características](#características)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Inicio rápido](#inicio-rápido)
- [Cómo funciona](#cómo-funciona)
- [Uso](#uso)
  - [Asistente interactivo](#asistente-interactivo)
  - [Recetas](#recetas)
- [Comandos](#comandos)
- [Opciones](#opciones)
- [Archivo de configuración](#archivo-de-configuración)
- [Autenticación](#autenticación)
- [Dibujar en tu gráfica](#dibujar-en-tu-gráfica)
- [Mensajes de commit](#mensajes-de-commit)
- [Solución de problemas y preguntas frecuentes](#solución-de-problemas-y-preguntas-frecuentes)
- [Uso responsable](#uso-responsable)
- [Contribuir](#contribuir)
- [Hoja de ruta](#hoja-de-ruta)
- [Licencia](#licencia)

## ¿Por qué retrocommit?

Tu gráfica de contribuciones solo cuenta una parte de la historia. El trabajo en servidores Git de
empresa, los proyectos en GitLab o Bitbucket o ese disco lleno de proyectos personales que nunca
subiste: nada de eso pinta un cuadro de verde. **retrocommit** te deja rellenar esos huecos como
quieras: exactamente los días que elijas, con los commits que quieras, en un repositorio que tú
controlas.

Y además es divertido: escribe tu nombre en tu perfil, dibuja pixel art o prueba cómo quedaría un
año "realista" antes de crear nada.

## Características

- 🗓️ **Cualquier periodo**: fechas exactas, meses completos, años o relativo (`6m`, `1y`).
- 🎲 **Cantidades fijas o aleatorias** por día, con distribución uniforme, en campana o de aspecto natural.
- 📆 **Elige los días**: días de la semana, porcentaje de días activos, pesos por día y fechas excluidas (festivos, vacaciones).
- 🕘 **Horas realistas** dentro de una franja horaria, en tu zona horaria (con cambios de horario incluidos).
- 🕳️ **Solo los huecos**: lee tu gráfica real y salta, o completa, los días que ya tienen contribuciones.
- ✍️ **Dibuja en tu gráfica**: escribe texto o haz pixel art.
- 🚀 **Un solo comando** crea el repositorio en GitHub (privado o público, en tu cuenta o en una organización) y lo sube.
- ⚡ **Rápido**: usa `git fast-import`, así que decenas de miles de commits tardan segundos.
- 🔁 **Reproducible**: cada plan tiene una semilla. Previsualízalo y después crea exactamente lo mismo.
- 🧙 **Tres formas de usarlo**: asistente interactivo, flags para scripts o un archivo de configuración JSON/YAML con autocompletado en el editor.
- 🧯 **Seguro por diseño**: valida todo, tiene vista previa y confirmaciones, nunca guarda tu token en disco y `delete` deshace lo hecho.
- 🖥️ **Multiplataforma**: macOS, Linux y Windows, todo en la terminal.

## Requisitos

- [Node.js](https://nodejs.org) **22.12 o superior**
- [Git](https://git-scm.com/downloads) **2.20 o superior** (se recomienda 2.31+)
- Una cuenta de GitHub y un [token](#autenticación) (para crear los repositorios por ti)

## Instalación

```bash
npm install --global retrocommit
```

O ejecútalo sin instalar nada:

```bash
npx retrocommit
```

<details>
<summary>pnpm, Yarn y Bun</summary>

```bash
pnpm add --global retrocommit     # o: pnpm dlx retrocommit
yarn global add retrocommit       # o: yarn dlx retrocommit
bun add --global retrocommit      # o: bunx retrocommit
```

</details>

Comprueba que todo está listo:

```bash
retrocommit doctor
```

## Inicio rápido

**1. Crea un token.** [Este enlace](https://github.com/settings/tokens/new?scopes=repo&description=retrocommit)
abre la página de "nuevo token" de GitHub con el permiso correcto (`repo`) ya marcado.

**2. Hazlo disponible** en tu terminal (retrocommit nunca lo guarda en disco):

```bash
# macOS / Linux
export RETROCOMMIT_TOKEN=ghp_tu_token

# Windows (PowerShell)
$env:RETROCOMMIT_TOKEN = "ghp_tu_token"
```

> ¿Ya usas la [CLI de GitHub](https://cli.github.com)? Entonces sáltate este paso: retrocommit usa su sesión automáticamente.

**3. Ejecútalo.** Sin opciones, un asistente breve te pregunta lo necesario:

```bash
retrocommit
```

O ve directo al grano: primero la vista previa y después la creación:

```bash
retrocommit preview --from 2024-01-01 --to 2024-12-31 --commits 1-8 --seed 42
retrocommit         --from 2024-01-01 --to 2024-12-31 --commits 1-8 --seed 42
```

<div align="center">
<img src="docs/assets/preview.png" alt="Vista previa de un plan y su gráfica de contribuciones en la terminal" width="780">
</div>

## Cómo funciona

1. **Planifica cada día.** A partir de tus opciones (y una semilla), retrocommit decide cuántos commits lleva cada día. El plan es determinista: las mismas opciones y semilla dan siempre el mismo resultado, así que la vista previa es exactamente lo que se crea.
2. **Escribe el historial de una sola vez.** En lugar de ejecutar `git commit` miles de veces, envía todos los commits, cada uno con su fecha exacta de autor y de committer, a [`git fast-import`](https://git-scm.com/docs/git-fast-import). Por eso es rápido.
3. **Acierta con las fechas.** GitHub coloca cada commit en el calendario [según la zona horaria guardada en el propio commit](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference), así que retrocommit escribe las horas en *tu* zona horaria, con los cambios de horario incluidos.
4. **Se asegura de que cuenten.** Los commits llevan tu dirección no-reply de GitHub (`ID+usuario@users.noreply.github.com`), que siempre está vinculada a tu cuenta. Van a la rama por defecto de un repositorio tuyo, que es lo que [exige GitHub](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-profile/managing-contribution-settings-on-your-profile/why-are-my-contributions-not-showing-up-on-my-profile).
5. **Crea y sube.** Crea el repositorio con la API de GitHub y hace push por HTTPS. El token solo pasa por el entorno de git: nunca va en la URL, en `.git/config` ni al disco.

<div align="center">
<img src="docs/assets/before-after.png" alt="Una gráfica de contribuciones antes y después de usar retrocommit" width="780">
</div>

## Uso

### Asistente interactivo

Ejecuta `retrocommit` sin opciones en una terminal. Te pregunta:

1. El periodo (últimos 12 meses, este año, un año concreto o un rango personalizado)
2. Qué crear (commits según un horario, texto en tu gráfica o un archivo de patrón)
3. Commits por día (rango aleatorio o fijo), días de la semana y con qué frecuencia
4. Qué hacer con los días que ya tienen contribuciones
5. A dónde van los commits (repositorio nuevo en GitHub, un remoto existente o solo una carpeta local)

Después muestra el plan y la gráfica, pide confirmación y al final ofrece guardar tus respuestas en
`retrocommit.config.json` para reutilizarlas.

Añade `-i` para abrir el asistente aunque pases otras opciones o tengas un archivo de configuración.

### Recetas

**Rellenar los últimos 12 meses** (el periodo por defecto):

```bash
retrocommit --commits 1-6
```

**Rellenar un año concreto:**

```bash
retrocommit --year 2023
```

**Solo entre semana, casi todos los días, con una campana de 2 a 10 commits:**

```bash
retrocommit --from 2024-01 --to 2024-06 --days weekdays --frequency 85 --commits 2-10 --distribution normal
```

**Actividad de aspecto natural** (menos fines de semana, casi siempre días tranquilos y algunos muy activos):

```bash
retrocommit --preset realistic
```

| Preset      | Commits por día | Días activos | Notas                                        |
| ----------- | --------------- | ------------ | -------------------------------------------- |
| `casual`    | 1–3             | 45%          | la mitad de probable en fin de semana, sesgada |
| `realistic` | 1–8             | 70%          | fines de semana más tranquilos, sesgada      |
| `workweek`  | 2–8             | 90%          | de lunes a viernes, en campana               |
| `intense`   | 5–20            | 100%         | todos los días, en campana                   |

Cualquier opción que pases tiene prioridad sobre el preset: `--preset realistic --commits 1-12`.

**Solo los días sin contribuciones** (lee tu gráfica real):

```bash
retrocommit --from 1y --fill gaps
```

**Completar los días flojos** para que cada día llegue al menos a 3 contribuciones:

```bash
retrocommit --fill top-up --commits 3
```

**Saltar festivos y vacaciones:**

```bash
retrocommit --year 2024 --exclude 2024-12-24..2024-12-31 --exclude 2024-08
```

**Commits de madrugada, en otra zona horaria:**

```bash
retrocommit --time 21:00-23:59 --timezone America/Mexico_City
```

**Tus propios mensajes de commit:**

```bash
retrocommit --message "chore: notas del día {date} ({n}/{count})"
retrocommit --messages-file ./mensajes.txt     # un mensaje por línea, elegido al azar
```

**Escribir en tu gráfica o dibujar un patrón:**

```bash
retrocommit --text "HOLA" --public
retrocommit --pattern ./examples/heart.txt --year 2024
```

**Repositorio público, otro nombre o una organización:**

```bash
retrocommit --public --repo mi-actividad --description "Cosas que hice"
retrocommit --owner mi-org --repo activity
```

**Añadir más commits después, o empezar de cero:**

```bash
retrocommit --from 2025-01-01 --to 2025-03-31 --if-exists append    # encima del historial existente
retrocommit --year 2025 --if-exists replace                           # sobrescribe lo que creó retrocommit
```

**Crear el repositorio solo en local** y subirlo tú:

```bash
retrocommit --no-push --output ./mi-historial
```

**Subir a un repositorio que ya tienes** (GitHub por SSH, GitLab, Gitea, Bitbucket…) con tus propias credenciales de git:

```bash
retrocommit --remote git@github.com:tu-usuario/activity.git
retrocommit --remote https://gitlab.com/tu-usuario/activity.git
```

**GitHub Enterprise Server:**

```bash
retrocommit --host github.miempresa.com
```

**Scripts y CI** (sin preguntas, salida legible por máquinas):

```bash
retrocommit --config ./retrocommit.config.yaml --yes --json
```

## Comandos

| Comando                     | Descripción                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `retrocommit [opciones]`    | Planifica los commits, los muestra, pide confirmación, los crea y hace push.                   |
| `retrocommit preview`       | Muestra el plan y la gráfica sin crear nada. Alias: `plan`, o `--dry-run`.                     |
| `retrocommit init`          | Crea un archivo de configuración con el asistente, o una plantilla documentada (`--defaults`). |
| `retrocommit graph`         | Dibuja tu gráfica real (o la de cualquiera, con `--user`) en la terminal.                      |
| `retrocommit doctor`        | Revisa Node.js, git, tu token, sus permisos y tu límite de la API.                             |
| `retrocommit delete <repo>` | Borra un repositorio creado por retrocommit: el botón de deshacer. Alias: `remove`.            |

Ejecuta `retrocommit <comando> --help` para ver las opciones de cada comando.

## Opciones

Todas las opciones funcionan también en un [archivo de configuración](#archivo-de-configuración)
con su nombre en camelCase (`--max-commits` → `maxCommits`).

<details open>
<summary><b>Rango de fechas</b></summary>

| Flag                | Clave         | Por defecto | Descripción                                                                                  |
| ------------------- | ------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `-f, --from <fecha>` | `from`       | `1y`        | Primer día: `2024-01-15`, `2024-03`, `2024`, `today`, `yesterday` o relativo (`30d`, `12w`, `6m`, `1y`). |
| `-t, --to <fecha>`  | `to`          | `today`     | Último día (mismos formatos).                                                                |
| `--year <año>`      | `year`        |             | Un año natural completo (en lugar de `--from`/`--to`).                                       |
| `--exclude <fechas>` | `exclude`    |             | Días a saltar: `2024-12-25`, `2024-08` o `2024-08-01..2024-08-15`. Se puede repetir.         |
| `--allow-future`    | `allowFuture` | `false`     | Permite fechas posteriores a hoy.                                                            |
| `--timezone <zona>` | `timezone`    | la del sistema | Zona horaria IANA (`Europe/Madrid`), `UTC` o un desfase (`+05:30`).                       |

</details>

<details open>
<summary><b>Horario</b></summary>

| Flag                        | Clave          | Por defecto   | Descripción                                                                      |
| --------------------------- | -------------- | ------------- | -------------------------------------------------------------------------------- |
| `-c, --commits <n\|min-max>` | `commits`     | `1-5`         | Commits por día activo: fijo (`5`) o aleatorio (`1-10`). Máximo 1000.            |
| `--distribution <tipo>`     | `distribution` | `uniform`     | `uniform`, `normal` (campana) o `skewed` (casi siempre bajo, aspecto natural).   |
| `--frequency <porcentaje>`  | `frequency`    | `100`         | Porcentaje de los días seleccionados que reciben commits.                        |
| `--days <días>`             | `days`         | `all`         | `all`, `weekdays`, `weekends`, listas (`mon,wed,fri`) o rangos (`mon-fri`).      |
| `--weights <pesos>`         | `weights`      |               | Probabilidad relativa por día de la semana, p. ej. `sat=0.3,sun=0.2`.            |
| `--fill <modo>`             | `fill`         | `all`         | Todos los días (`all`), solo `gaps` (días sin contribuciones) o `top-up` hasta el objetivo. |
| `--preset <nombre>`         | `preset`       |               | `casual`, `realistic`, `workweek` o `intense`.                                   |
| `--time <desde-hasta>`      | `time`         | `09:00-21:00` | Franja horaria local de los commits.                                             |
| `--seed <valor>`            | `seed`         | aleatoria     | Reproduce exactamente el mismo plan.                                             |
| `--max-commits <n>`         | `maxCommits`   | `50000`       | Límite de seguridad del total de commits.                                        |

</details>

<details open>
<summary><b>Dibujo</b></summary>

| Flag                  | Clave       | Por defecto | Descripción                                                    |
| --------------------- | ----------- | ----------- | -------------------------------------------------------------- |
| `--text <texto>`      | `text`      |             | Escribe texto en tu gráfica ([detalles](#dibujar-en-tu-gráfica)). |
| `--pattern <archivo>` | `pattern`   |             | Dibuja un archivo de patrón.                                   |
| `--intensity <n>`     | `intensity` | `12`        | Commits de los cuadros más oscuros.                            |

</details>

<details open>
<summary><b>Commits</b></summary>

| Flag                          | Clave          | Por defecto                          | Descripción                                               |
| ----------------------------- | -------------- | ------------------------------------ | --------------------------------------------------------- |
| `-m, --message <plantilla>`   | `message`      | `Update activity log ({date} #{n})`  | Plantilla del mensaje ([marcadores](#mensajes-de-commit)). |
| `--messages-file <archivo>`   | `messagesFile` |                                      | Elige mensajes al azar de un archivo (uno por línea).     |
| `--author-name <nombre>`      | `authorName`   | tu nombre de GitHub                  | Nombre del autor de los commits.                          |
| `--author-email <email>`      | `authorEmail`  | tu email no-reply de GitHub          | Email del autor. Debe estar vinculado a tu cuenta.        |
| `--content <modo>`            | `content`      | `single`                             | Qué cambia cada commit: un log (`single`), archivos por día (`daily`) o nada (`empty`). |
| `--content-path <ruta>`       | `contentPath`  | `activity.log` / `activity`          | El archivo de log (`single`) o la carpeta (`daily`).      |
| `--readme [archivo]`          | `readme`       | activado                             | Añade un README.md (opcionalmente el tuyo). `--no-readme` para omitirlo. |

</details>

<details open>
<summary><b>Repositorio</b></summary>

| Flag                     | Clave         | Por defecto                               | Descripción                                                          |
| ------------------------ | ------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `-r, --repo <nombre>`    | `repo`        | `activity-log`                            | Nombre del repositorio.                                              |
| `--owner <org>`          | `owner`       | tú                                        | Crea el repositorio en una organización.                             |
| `--private` / `--public` | `visibility`  | privado                                   | Visibilidad del repositorio.                                         |
| `--description <texto>`  | `description` | `Activity log generated with retrocommit` | Descripción del repositorio.                                         |
| `--topics <lista>`       | `topics`      | `retrocommit`                             | Topics separados por comas. `delete` y `replace` buscan `retrocommit`. |
| `--branch <nombre>`      | `branch`      | `main`                                    | Rama a escribir (en repositorios existentes: su rama por defecto).   |
| `--if-exists <acción>`   | `ifExists`    | `fail`                                    | Si el repositorio ya tiene commits: `fail`, `append` o `replace`.    |
| `--force`                |               |                                           | Permite `replace` en repositorios que no creó retrocommit.           |
| `--no-push`              | `push`        | push                                      | Solo crea el repositorio en local.                                   |
| `-o, --output <carpeta>` | `output`      |                                           | Guarda el repositorio generado en esta carpeta.                      |
| `--remote <url>`         | `remote`      |                                           | Sube a un remoto existente con tus propias credenciales de git.      |
| `--protocol <protocolo>` | `protocol`    | `https`                                   | Sube a GitHub con el token (`https`) o con tus llaves SSH (`ssh`).   |

</details>

<details open>
<summary><b>GitHub, configuración y salida</b></summary>

| Flag                | Clave    | Por defecto  | Descripción                                                      |
| ------------------- | -------- | ------------ | ---------------------------------------------------------------- |
| `--token <token>`   |          |              | Token de GitHub. Mejor usa la variable `RETROCOMMIT_TOKEN`.      |
| `--host <host>`     | `host`   | `github.com` | Host de GitHub Enterprise Server.                                |
| `--api-url <url>`   | `apiUrl` |              | URL de la API de GitHub, si no es `https://<host>/api/v3`.       |
| `--config <archivo>` |         | automático   | Lee las opciones de este archivo JSON/YAML.                      |
| `--no-config`       |          |              | Ignora los archivos de configuración.                            |
| `-i, --interactive` |          |              | Abre el asistente.                                               |
| `-y, --yes`         |          |              | No pide confirmación (obligatorio fuera de una terminal).        |
| `--dry-run`         |          |              | Solo muestra el plan (igual que `retrocommit preview`).          |
| `--json`            |          |              | Salida legible por máquinas.                                     |
| `-q, --quiet`       |          |              | Solo muestra errores y el resultado final.                       |
| `--verbose`         |          |              | Muestra detalles de depuración.                                  |
| `--no-graph`        |          |              | No dibuja la gráfica.                                            |
| `--ascii`           |          |              | Salida solo con caracteres ASCII (para terminales antiguas).     |
| `--no-color`        |          |              | Desactiva los colores (también respeta `NO_COLOR`).              |

</details>

**Códigos de salida:** `0` éxito · `1` error · `2` opciones no válidas o falta confirmación · `130` cancelado.

## Archivo de configuración

Guarda tu configuración favorita en un archivo y ejecuta `retrocommit` en esa carpeta. Busca, en
este orden: `retrocommit.config.json`, `retrocommit.config.yaml`, `retrocommit.config.yml`,
`.retrocommitrc`, `.retrocommitrc.json`, `.retrocommitrc.yaml`, `.retrocommitrc.yml`. También
puedes usar `--config <archivo>`.

Créalo con el asistente u obtén una plantilla totalmente documentada:

```bash
retrocommit init                     # te hace preguntas
retrocommit init --defaults --format yaml
```

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/retrocommit/schema.json
from: 2024-01-01
to: 2024-12-31
preset: realistic
commits: 1-10
exclude:
  - 2024-12-24..2024-12-31
time: 10:00-19:00
timezone: Europe/Madrid
fill: gaps
repo: activity-log
visibility: private
```

- Precedencia: **valores por defecto < preset < archivo < respuestas del asistente < flags**.
- Las rutas relativas (`messagesFile`, `pattern`, `output`, `readme`) se resuelven desde la carpeta del archivo.
- Las claves desconocidas dan error (con una sugerencia de "¿quisiste decir…?"), así que ninguna errata pasa desapercibida.
- El [JSON Schema](schema.json) te da autocompletado y validación en VS Code y otros editores.
- **No** se permiten tokens en los archivos de configuración. Usa una variable de entorno.

Tienes más ejemplos en [`examples/`](examples).

## Autenticación

retrocommit busca un token en este orden:

1. `--token <token>` (mejor evitarlo: queda en el historial de tu shell)
2. Las variables de entorno `RETROCOMMIT_TOKEN`, `GH_TOKEN` o `GITHUB_TOKEN` (`GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN` para hosts Enterprise)
3. La [CLI de GitHub](https://cli.github.com), si has iniciado sesión (`gh auth token`)
4. Una pregunta oculta, cuando se ejecuta en una terminal

Solo se guarda en memoria durante la ejecución. Git lo recibe por variables de entorno, así que
nunca aparece en la URL del remoto, en `.git/config`, en la lista de procesos (git 2.31+) ni en
ningún mensaje de error.

**Token clásico** ([crear uno](https://github.com/settings/tokens/new?scopes=repo&description=retrocommit)):

| Permiso (scope) | Necesario para                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `repo`          | Crear repositorios privados y subirles commits (incluye los públicos).    |
| `public_repo`   | Suficiente si solo usas `--public`.                                       |
| `delete_repo`   | Solo para `retrocommit delete`.                                           |

**Token fine-grained**: dale acceso a *All repositories* con estos permisos de repositorio:
**Administration: Read and write** (crear repositorios, poner topics, borrarlos) y
**Contents: Read and write** (hacer push). Metadata (lectura) se añade automáticamente.

**SSH en lugar de HTTPS**: con `--protocol ssh`, el token solo se usa para la API y el push va
con tus llaves SSH. Con `--remote <url>`, retrocommit no necesita token, salvo para
`--fill gaps` / `top-up`.

## Dibujar en tu gráfica

**Texto** (`--text "HOLA"`): usa una fuente propia de 5 cuadros de alto, dibujada de lunes a
viernes. Admite `A–Z`, `0–9`, espacio y `! ? . , : ; ' " - _ + = * / \ ( ) [ ] < > # @ & % $ ^ | ♥ ★`.
En un año caben unos 8–10 caracteres.

Dónde se coloca:

- **Por defecto**: centrado en las 52 semanas completas que muestra tu perfil. Esa vista avanza con las semanas, así que el dibujo se desplaza a la izquierda y acaba saliendo de la vista por defecto.
- **`--year 2024`**: centrado en la vista de ese año en tu perfil, donde se queda para siempre.
- **`--from <fecha>`**: desde la primera semana completa a partir de esa fecha.

**Patrones** (`--pattern arte.txt`): archivos de texto de hasta 7 líneas, de domingo a sábado, un
carácter por semana. `.`, un espacio o `0` dejan el cuadro vacío; `1`–`4` marcan la intensidad;
cualquier otro carácter equivale a `4`. Los archivos con menos de 7 líneas se centran en vertical.

```text
.##...##.
#..#.#..#
#...#...#
.#.....#.
..#...#..
...#.#...
....#....
```

GitHub colorea cada día en relación con tus días más activos. Si ya tienes días con muchas
contribuciones, sube `--intensity` para que el dibujo use el verde más oscuro. Las contribuciones
que ya existen en los cuadros "vacíos" no se pueden quitar, así que los mejores resultados se
consiguen en años tranquilos (y con `--fill top-up`).

## Mensajes de commit

`--message` y cada línea de `--messages-file` son plantillas:

| Marcador     | Ejemplo                     | Marcador  | Ejemplo            |
| ------------ | --------------------------- | --------- | ------------------ |
| `{date}`     | `2024-03-05`                | `{n}`     | `2` (en el día)    |
| `{time}`     | `14:23:11`                  | `{count}` | `5` (ese día)      |
| `{datetime}` | `2024-03-05T14:23:11+01:00` | `{i}`     | `42` (en total)    |
| `{weekday}`  | `Tuesday`                   | `{total}` | `1230`             |
| `{year}`     | `2024`                      | `{month}` | `03`               |
| `{day}`      | `05`                        |           |                    |

Usa `{{` y `}}` para escribir llaves literales. En un archivo de mensajes se ignoran las líneas
vacías y las que empiezan por `#`. Mira [`examples/messages.txt`](examples/messages.txt).

## Solución de problemas y preguntas frecuentes

<details>
<summary><b>No aparecen mis contribuciones</b></summary>

1. **Espera un poco.** GitHub puede tardar [hasta 24 horas](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-profile/managing-contribution-settings-on-your-profile/why-are-my-contributions-not-showing-up-on-my-profile) en actualizar la gráfica.
2. **¿Repositorio privado?** Activa *Include private contributions on my profile* en [Settings → Public profile → Contributions & activity](https://github.com/settings/profile). Sin eso, los visitantes no las ven.
3. **¿Usaste `--author-email`?** Tiene que ser un email verificado de tu cuenta ([Settings → Emails](https://github.com/settings/emails)). La dirección no-reply por defecto siempre funciona.
4. **¿Subiste a un repositorio existente?** Solo cuentan los commits de su **rama por defecto**, y nunca en forks.

</details>

<details>
<summary><b>"Your push would publish a private email address" (GH007)</b></summary>

Usaste `--author-email` con una dirección que tienes como privada en GitHub. Quita `--author-email`
para que se use tu dirección no-reply.

</details>

<details>
<summary><b>Errores del token (401, 403, permisos que faltan)</b></summary>

Ejecuta `retrocommit doctor`: te dice qué token encontró, de quién es y qué permisos tiene. Si
hace falta, crea uno nuevo con [este enlace](https://github.com/settings/tokens/new?scopes=repo&description=retrocommit).

</details>

<details>
<summary><b>El repositorio ya existe</b></summary>

Por defecto retrocommit no toca un repositorio que ya tiene commits. Usa `--if-exists append` para
añadir commits encima, `--if-exists replace` para sobrescribir un repositorio creado por
retrocommit, o `--repo` para usar otro nombre. Si una ejecución falló después de crear el
repositorio, al repetirla se reutiliza el repositorio vacío.

</details>

<details>
<summary><b>Detrás de un proxy corporativo</b></summary>

Define `HTTPS_PROXY` y `NODE_USE_ENV_PROXY=1` para que Node.js lo use en las llamadas a la API. Git
usa su propia configuración de proxy (`git config --global http.proxy …`).

</details>

<details>
<summary><b>Windows</b></summary>

retrocommit funciona en PowerShell, en el Símbolo del sistema y en Windows Terminal. Instala
[Git para Windows](https://git-scm.com/download/win) o ejecuta `winget install --id Git.Git -e`, y
abre una terminal nueva. Si los cuadros o los símbolos se ven mal en una consola antigua, añade
`--ascii`.

</details>

<details>
<summary><b>¿Cómo lo deshago?</b></summary>

```bash
retrocommit delete activity-log
```

Al borrar el repositorio, sus contribuciones desaparecen de tu gráfica. `delete` solo borra
repositorios con el topic `retrocommit` (salvo que añadas `--force`) y te pide escribir el nombre
para confirmar. Necesita un token con el permiso `delete_repo`; también puedes borrarlo desde los
ajustes del repositorio en GitHub.

</details>

<details>
<summary><b>¿Funciona con GitLab, Gitea o Bitbucket?</b></summary>

Sí, con `--remote <url>`: crea allí el repositorio y retrocommit subirá los commits con tus propias
credenciales. Sus gráficas de contribuciones siguen sus propias reglas (normalmente, el email tiene
que ser de tu cuenta).

</details>

## Uso responsable

retrocommit crea commits normales con fechas personalizadas en un repositorio tuyo. Cómo lo uses
depende de ti, pero sé honesto: una gráfica de contribuciones dice poco de las habilidades de
alguien y no debería usarse para engañar a empresas, clientes ni a nadie. Lee los
[Términos de servicio](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) de GitHub; lo usas bajo tu propia responsabilidad.
Este software se ofrece "tal cual", sin garantías de ningún tipo (consulta la [licencia](LICENSE)).

## Contribuir

Toda contribución es bienvenida: reportes de errores, ideas, documentación y código. Empieza por
[CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/abpineda/retrocommit.git
cd retrocommit
npm install
npm test          # tests unitarios, de integración (git real) y end-to-end
npm run build     # genera dist/cli.js
node dist/cli.js preview --preset realistic
```

Lee el [Código de conducta](CODE_OF_CONDUCT.md). Los problemas de seguridad se reportan según la
[política de seguridad](SECURITY.md).

## Hoja de ruta

- [ ] Binarios independientes (sin Node.js) y paquetes para Homebrew / Scoop / WinGet
- [ ] Autocompletado para la shell
- [ ] Más fuentes y patrones incluidos
- [ ] Traducciones de la interfaz de la línea de comandos

¿Tienes una idea? [Abre una propuesta](https://github.com/abpineda/retrocommit/issues/new?template=feature_request.yml).

## Licencia

[MIT](LICENSE) © 2026 abpineda

<div align="center">

Si retrocommit te ha servido, dale una ⭐ en GitHub.

</div>
