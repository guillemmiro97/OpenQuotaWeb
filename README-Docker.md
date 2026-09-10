# OpenQuota Web (Docker)

Aplicación **web real** de OpenQuota: reutiliza toda la lógica de proveedores del
proyecto original (Rust) y sirve el dashboard (Svelte) por HTTP, sin VNC, sin
X11 y sin WebKit.

```
Navegador  ──HTTP/SSE──►  openquota-server (Rust/Axum)  ──►  APIs de proveedores
                                 │                         (reqwest)
                                 ├── SQLite (histórico y ajustes)
                                 ├── $CODEX_HOME / $CLAUDE_CONFIG_DIR / OpenCode
                                 └── fichero de API keys (0600)
```

No se reescribió ningún proveedor: se extrajo la lógica compartida del binario
Tauri y se expone mediante un servidor Axum que ofrece los mismos comandos que
la app de escritorio.

---

## Índice

- [Inicio rápido](#inicio-rápido)
- [Arquitectura y cambios respecto al original](#arquitectura-y-cambios-respecto-al-original)
- [Configuración](#configuración)
- [Credenciales de proveedores](#credenciales-de-proveedores)
- [Persistencia y backup](#persistencia-y-backup)
- [Seguridad](#seguridad)
- [Actualizaciones](#actualizaciones)
- [Desarrollo](#desarrollo)
- [API](#api)
- [Matriz de proveedores](#matriz-de-proveedores)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Verificación](#verificación)

---

## Inicio rápido

```bash
docker compose up -d
```

Abre <http://localhost:8080/>.

La interfaz es un **dashboard web a ancho completo y responsivo**: cabecera con
acciones (Refrescar, Customize, Settings), una fila de KPIs (gasto, proveedores,
alertas) y un grid de tarjetas por proveedor que pasa de 3 a 2 a 1 columna según
el tamaño de la ventana. Las pantallas de Customize y Settings se mantienen
centradas para facilitar la lectura.

La primera construcción compila el frontend (Node) y el servidor (Rust); puede
tardar unos minutos. Después, el arranque es rápido.

```bash
docker compose ps        # debe mostrar "healthy"
docker compose logs -f   # logs del servidor
```

---

## Arquitectura y cambios respecto al original

Se parte de `deviffyy/OpenQuota` **v0.5.0** y se mantiene el código original. Los
cambios son mínimos y están marcados por la feature `web`:

| Fichero | Cambio |
| --- | --- |
| `src-tauri/Cargo.toml` | Features `desktop` (por defecto) y `web`; las dependencias de Tauri pasan a ser opcionales. Se añade el binario `openquota-server`. |
| `src-tauri/src/lib.rs` | Los módulos compartidos pasan a `pub`; la app Tauri queda bajo `feature = "desktop"`. |
| `src-tauri/src/runtime.rs` | Helper tokio compartido que sustituye a `tauri::async_runtime` en el código compartido. |
| `src-tauri/src/service.rs`, `provider_environment.rs`, `providers/detection.rs` | `tauri::async_runtime` → `crate::runtime`. |
| `src-tauri/src/providers/api_key.rs` | En web usa un almacén de credenciales en fichero; en escritorio mantiene el llavero del sistema. |
| `src-tauri/src/logging.rs` | Salida opcional de logs a stdout (`enable_console_output`). |
| `src-tauri/src/server/` | **Nuevo**: servidor Axum (rutas, SSE, refresh loop, secret store). |
| `src/lib/backend.ts` | Se reescribe para hablar HTTP/SSE en vez de `invoke`/`listen`, con la **misma API pública**. |
| `src/lib/tauriWindowStub.ts` + `vite.config.ts` | Stub de `@tauri-apps/api/window` para el build web. |
| `src/styles/web.css` | Centra el panel en la página. |

El build de escritorio original sigue funcionando (`cargo check --lib`).

---

## Configuración

Copia `.env.example` a `.env` y edítalo:

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `OPENQUOTA_AUTH_USER` | *(vacío)* | Usuario de HTTP Basic (opcional). |
| `OPENQUOTA_AUTH_PASSWORD` | *(vacío)* | Contraseña de HTTP Basic (opcional). |
| `OPENROUTER_API_KEY` | *(vacío)* | API key de OpenRouter. |
| `DEEPSEEK_API_KEY` | *(vacío)* | API key de DeepSeek. |
| `ZAI_API_KEY` / `GLM_API_KEY` | *(vacío)* | API key de Z.ai. |
| `KIMI_API_KEY` | *(vacío)* | API key de Kimi. |
| `MINIMAX_API_KEY` | *(vacío)* | API key de MiniMax. |

Variables del servidor (normalmente no hace falta tocarlas):

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `OPENQUOTA_HOST` | `0.0.0.0` | Interfaz de escucha. |
| `OPENQUOTA_PORT` | `8080` | Puerto. |
| `OPENQUOTA_STATIC_DIR` | `/app/dist` | Frontend compilado. |
| `OPENQUOTA_APP_DATA_DIR` | `$XDG_DATA_HOME/io.github.deviffyy.openquota` | Directorio de datos. |

Si defines `OPENQUOTA_AUTH_USER` y `OPENQUOTA_AUTH_PASSWORD`, **todo** el
dashboard queda protegido con HTTP Basic (el endpoint `/api/health` queda
exento para el healthcheck). Basta con una sola vez: el navegador recuerda las
credenciales.

---

## Credenciales de proveedores

### Proveedores basados en CLI (Codex, Claude, OpenCode)

Estos proveedores leen ficheros locales. Tienes dos opciones:

**A) Importar desde la web (recomendado).** En el dashboard entra en
**Customize → (proveedor) → Sign in** y pega el contenido del fichero de
credenciales. El servidor lo guarda con permisos `0600` en la ruta correcta y
activa el proveedor automáticamente.

| Proveedor | Fichero a pegar (en tu equipo) |
| --- | --- |
| Codex | `~/.codex/auth.json` |
| Claude | `~/.claude/.credentials.json` |
| OpenCode | `~/.local/share/opencode/auth.json` |
| Antigravity | `auth.json` de Antigravity |

**B) Montar los directorios del host** en el contenedor. `docker-compose.yml`
ya monta Codex y OpenCode desde `${USERPROFILE}` (Windows); en Linux/macOS
cambia `${USERPROFILE}` por `${HOME}`. Elimina esas líneas si prefieres importar
las credenciales desde la web.

```yaml
volumes:
  - openquota-data:/data
  - openquota-config:/config
  - ${HOME}/.codex:/data/home/.codex
  - ${HOME}/.claude:/data/home/.claude
  - ${HOME}/.local/share/opencode:/data/xdg-data/opencode
```

Rutas que lee OpenQuota:

| Proveedor | Variable | Ruta por defecto |
| --- | --- | --- |
| Codex | `CODEX_HOME` | `/data/home/.codex` (`auth.json`, `sessions/`) |
| Claude | `CLAUDE_CONFIG_DIR` | `/data/home/.claude` (`.credentials.json`) |
| OpenCode | `OPENCODE_DATA_DIR` / `XDG_DATA_HOME` | `/data/xdg-data/opencode` |
| Antigravity | — | `/data/xdg-data/io.github.deviffyy.openquota/antigravity/auth.json` |

### Proveedores con API key (OpenRouter, DeepSeek, Z.ai, Kimi, MiniMax)

1. **Desde la UI (recomendado)**: Customize → añade la key. Se guarda en
   `/data/xdg-data/io.github.deviffyy.openquota/secrets.json` con permisos `0600`
   dentro del volumen persistente.
2. **Variables de entorno**: define `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`,
   `ZAI_API_KEY`, `KIMI_API_KEY` o `MINIMAX_API_KEY` en `.env`.

Una key guardada en la UI tiene prioridad sobre la de entorno.

---

## Persistencia y backup

| Volumen | Montaje | Contenido |
| --- | --- | --- |
| `openquota_openquota-data` | `/data` | SQLite, precios, llavero en fichero, homes de CLIs |
| `openquota_openquota-config` | `/config` | `$XDG_CONFIG_HOME` (configs por proveedor) |

Todo sobrevive a `docker compose restart`.

```bash
# Backup
docker run --rm -v openquota_openquota-data:/data -v openquota_openquota-config:/config \
  -v "$PWD:/backup" alpine tar czf /backup/openquota-backup.tgz -C / data config

# Restore
docker compose down
docker run --rm -v openquota_openquota-data:/data -v openquota_openquota-config:/config \
  -v "$PWD:/backup" alpine sh -c 'rm -rf /data/* /config/* && tar xzf /backup/openquota-backup.tgz -C /'
docker compose up -d
```

El backup contiene credenciales: guárdalo de forma segura.

---

## Seguridad

- Por defecto **no hay autenticación**. Úsalo en localhost/LAN o activa
  `OPENQUOTA_AUTH_USER`/`OPENQUOTA_AUTH_PASSWORD`.
- No expongas el puerto 8080 directamente a Internet. Se recomienda un reverse
  proxy con TLS y autenticación:

```
Internet / LAN ──HTTPS──► Reverse proxy (nginx/Traefik/Caddy) ──HTTP──► openquota:8080
```

Ejemplo (Caddy):

```
quota.example.com {
    basic_auth {
        admin $2a$14$...
    }
    reverse_proxy openquota:8080
}
```

Ejemplo (nginx):

```nginx
location / {
    proxy_pass http://openquota:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;          # SSE
    proxy_read_timeout 3600s;
}
```

Para publicar solo en localhost, cambia el mapeo a `"127.0.0.1:8080:8080"`.

Nunca se imprimen API keys ni tokens en los logs.

---

## Actualizaciones

Cambia la versión base y reconstruye:

```bash
git fetch --tags && git checkout v0.6.0   # cuando exista
docker compose build --pull --no-cache
docker compose up -d
```

Los volúmenes se conservan.

---

## Desarrollo

Requisitos: Node 22 + pnpm 11.11.0, Rust estable.

```bash
# Frontend (servidor de desarrollo con proxy al backend, ver más abajo)
corepack pnpm install --frozen-lockfile

# Servidor web (sustituye a `tauri dev`)
cargo run --manifest-path src-tauri/Cargo.toml \
  --no-default-features --features web --bin openquota-server
```

El servidor sirve el frontend compilado desde `OPENQUOTA_STATIC_DIR`. Para
desarrollo con recarga, compila el frontend (`corepack pnpm build`) y reinicia el
servidor, o sirve `dist` con tu herramienta favorita y apunta `/api` al servidor.

---

## API

El servidor expone los mismos comandos que usaba la app de escritorio:

| Método | Ruta | Equivalente Tauri |
| --- | --- | --- |
| GET | `/api/bootstrap` | `get_bootstrap_state` |
| GET | `/api/settings` | `get_app_settings` |
| PUT | `/api/settings` | `save_app_settings` |
| POST | `/api/settings/reset-customization` | `reset_customization` |
| POST | `/api/settings/reset-all` | `reset_all_settings` |
| POST | `/api/settings/reset-provider/{id}` | `reset_provider_customization` |
| POST | `/api/usage/refresh` | `refresh_usage` |
| POST | `/api/usage/refresh/{id}` | `refresh_provider_usage` |
| POST | `/api/codex/reset-claim` | `claim_codex_reset_credit` |
| GET/PUT/DELETE | `/api/providers/{id}/api-key` | `get/save/delete_provider_api_key` |
| GET | `/api/providers/{id}/links/{index}` | `open_provider_link` |
| PUT | `/api/providers/{id}/credentials` | Importar credenciales de CLI (Codex/Claude/OpenCode/Antigravity) |
| POST | `/api/notifications/permission` | `request_notification_permission` |
| GET | `/api/logs/path` | `get_log_path` |
| GET | `/api/updates` | `check_for_updates` (stub en web) |
| GET | `/api/events` | Eventos `usage-state` / `settings-state` (SSE) |
| GET | `/api/health` | Healthcheck |

---

## Matriz de proveedores

Refleja lo **realmente verificado** en este despliegue. Las cuotas/uso en vivo
no se pudieron verificar sin cuentas reales, por lo que se marcan como no
verificadas en lugar de asumirlas.

| Proveedor | Autenticación | Persistente | Cuota visible | Uso visible | Probado |
| --- | --- | --- | --- | --- | --- |
| Codex | ChatGPT OAuth (`codex login`) o montar `~/.codex` | sí | no verificado | no verificado | no (sin cuenta) |
| Claude | Claude OAuth (`claude`) o montar `~/.claude` | sí | no verificado | no verificado | no (sin cuenta) |
| OpenCode | datos locales (`OPENCODE_DATA_DIR`) | sí | no verificado | no verificado | no (sin cuenta) |
| OpenRouter | API key (UI / env) | sí | no verificado | no verificado | no (sin key real) |
| DeepSeek | API key (UI / env) | sí | no verificado | no verificado | no (sin key real) |
| Kimi | API key (UI / env) | sí | no verificado | no verificado | no (sin key real) |
| MiniMax | API key (UI / env) | sí | no verificado | no verificado | no (sin key real) |
| Z.ai | API key (UI / env) | sí | no verificado | no verificado | no (sin key real) |
| Antigravity | auth local en datos de la app | sí | no verificado | no verificado | no (sin cuenta) |
| Cursor | login de Cursor Agent | sí | no verificado | no verificado | no (sin cuenta) |
| Copilot | credenciales GitHub/Copilot | sí | no verificado | no verificado | no (sin cuenta) |
| Devin | credenciales Devin | sí | no verificado | no verificado | no (sin cuenta) |
| Grok | credenciales Grok | sí | no verificado | no verificado | no (sin cuenta) |

---

## Limitaciones conocidas

- **Sin notificaciones nativas ni auto-actualización**: son integraciones de
  escritorio (Tauri). En web, `/api/updates` devuelve "no hay actualización" y
  `openUpdatePage` abre la página de releases.
- **Sin bandeja ni atajos globales**: no aplican en web.
- **Credenciales de CLIs**: se importan desde la web (Customize → Sign in) o se
  montan desde el host. El servidor no ejecuta los CLIs.
- **Un solo usuario**: no hay cuentas ni aislamiento por usuario. Para varios
  usuarios, usa un proxy con autenticación por usuario y una instancia por
  usuario.
- **Almacén de API keys en fichero**: en web las keys se guardan en
  `secrets.json` (0600) en el volumen persistente, no en un llavero del sistema.
- **OpenCode sobre bind mounts (Docker Desktop en Windows/macOS)**: su base
  SQLite usa WAL y la memoria compartida (`-shm`) no funciona en esos montajes.
  OpenQuota abre la base en modo `immutable` como alternativa, por lo que puede
  faltar el uso más reciente hasta que el escritor haga checkpoint.
- **Cuotas de OpenCode Go**: solo aparecen si el `auth.json` incluye un login de
  OpenCode Go. Si usas OpenCode con tus propias claves (OpenAI, DeepSeek, etc.)
  se muestra el histórico de uso local, no las cuotas Go.

---

## Verificación

Verificado en Docker 29.6.2 / Compose v5.3.1 (linux/x86_64):

- La imagen compila (frontend Svelte + servidor Rust con `--features web`).
- `docker compose up -d` → contenedor **healthy**; `/api/health` responde.
- `http://localhost:8080/` sirve la SPA (200).
- **Navegador headless (Playwright/Chromium)**: el dashboard renderiza
  (`main.popover`), muestra las tarjetas de proveedor y el menú de opciones se
  abre. **Cero errores de consola.**
- **Dashboard a ancho completo y responsivo**: 3 columnas a 1440 px, 2 a 900 px
  y 1 a 480 px, con KPIs y tarjetas de proveedor; verificado en navegador
  headless.
- El panel queda **centrado** en la página (x=80..398 en un viewport de 480).
- **SSE**: al llamar a `POST /api/usage/refresh` el navegador recibe eventos
  `usage-state`.
- `GET /api/bootstrap` devuelve los **13 proveedores** (incluido **DeepSeek**) y
  el estado de ajustes.
- **Importar credenciales de CLI**: `PUT /api/providers/codex/credentials`
  escribe `~/.codex/auth.json` (`0600`) y activa el proveedor.
- **Sección "Sign in"** en la UI de proveedores CLI verificada en navegador
  headless (textarea + guardado), junto con la tarjeta de DeepSeek en el
  dashboard.
- **Persistencia de API keys**: guardar una key (`PUT`) crea `secrets.json` con
  permisos `0600` y el estado sigue siendo `saved` tras `docker compose restart`.
- **HTTP Basic opcional**: sin credenciales → 401; con credenciales → 200;
  `/api/health` → 200.
- Con los directorios del host montados, el dashboard muestra **datos reales**:
  Codex (plan Team, Session/Weekly con porcentaje y reset) y OpenCode (histórico
  de uso local), verificados en navegador headless.
- El **build de escritorio** original sigue compilando (`cargo check --lib`).

No verificado: valores de cuota/uso reales por proveedor (requieren credenciales
reales).
