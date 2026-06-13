# B4X IDE Companion en Linux (Wine) — Guía de instalación y configuración

Esta versión del fork añade soporte para usar B4X (B4J / B4A) instalado bajo un
**prefix de Wine** en Linux, con editor, IntelliSense (LSP), carga de librerías y
build/run mediante Wine.

> Esta guía asume que ya tienes B4J (o B4A) funcionando dentro de un prefix de Wine.

---

## 1. Requisitos previos

| Requisito | Notas |
|---|---|
| **VS Code** | Cualquier build reciente (1.95+) |
| **Wine** | `wine` y `winepath` accesibles en el `PATH` |
| **Java (JDK 11+)** | Necesario para compilar/ejecutar B4J (`java` en el `PATH` o ruta configurada) |
| **B4J instalado en Wine** | p. ej. en `~/.wine_b4x/drive_c/Program Files/Anywhere Software/B4J` |
| **`b4xV5.ini`** | Generado por B4J la primera vez que se abre bajo Wine |

Comprueba que Wine funciona antes de seguir:

```bash
wine --version
winepath -w "$HOME"      # debe devolver algo como Z:\home\usuario
java -version
```

---

## 2. Instalar la extensión (.vsix)

Desde el directorio donde está el `.vsix`:

```bash
code --install-extension b4x-intellisense-0.1.420.vsix --force
```

- El `--force` sobrescribe la versión del marketplace (mismo ID, versión superior).
- Si tenías la versión oficial del marketplace instalada, esta la reemplaza.
- Recarga la ventana si es necesario: **Ctrl+Shift+P → Developer: Reload Window**.

Para verificar que está activa:

```bash
code --list-extensions | grep b4x-intellisense
```

---

## 3. Configurar el proyecto B4X

Abre en VS Code la **carpeta del proyecto** (la que contiene el `.b4j`).

### Opción A — Interfaz de Settings (recomendada)

**Ctrl+Shift+P → Preferences: Open Settings (UI)** y filtra por `b4xintellisense`.

Ajusta estas opciones:

| Setting | Valor de ejemplo |
|---|---|
| `B4x Intellisense: Wine: Enabled` | `✔ activado` |
| `B4x Intellisense: Wine: Prefix` | `/home/usuario/.wine_b4x` |
| `B4x Intellisense: B4j Ini Path` | `/home/usuario/.wine_b4x/drive_c/users/usuario/AppData/Roaming/Anywhere Software/B4J/b4xV5.ini` |
| `B4x Intellisense: B4j Install Path` | `/home/usuario/.wine_b4x/drive_c/Program Files/Anywhere Software/B4J` |
| `B4x Intellisense: B4j Java Path` | *(vacío = usa el `java` del sistema, o ruta a un JDK)* |
| `B4x Intellisense: B4j Run After Build` | `✔ activado` (ejecuta el jar tras compilar) |

### Opción B — `.vscode/settings.json` directamente

Crea/edita `.vscode/settings.json` dentro de la carpeta del proyecto:

```jsonc
{
  "b4xIntellisense.wine.enabled": true,
  "b4xIntellisense.wine.prefix": "/home/usuario/.wine_b4x",
  "b4xIntellisense.b4jIniPath": "/home/usuario/.wine_b4x/drive_c/users/usuario/AppData/Roaming/Anywhere Software/B4J/b4xV5.ini",
  "b4xIntellisense.b4jInstallPath": "/home/usuario/.wine_b4x/drive_c/Program Files/Anywhere Software/B4J",
  "b4xIntellisense.b4jJavaPath": "",
  "b4xIntellisense.b4jRunAfterBuild": true
}
```

> Las rutas del INI y del install path son **rutas de Linux** (host), no de Wine.
> La extensión las traduce internamente.

### Ajustes opcionales de Wine

| Setting | Default | Cuándo cambiarlo |
|---|---|---|
| `wine.binary` | `wine` | Si `wine` no está en el `PATH`, pon la ruta completa |
| `winepath.binary` | `winepath` | Igual, si `winepath` no está en el `PATH` |
| `filterExplorerFiles` | `false` | Actívalo solo si quieres ocultar del Explorer los `.bas` no referenciados por el proyecto |

---

## 4. Abrir el proyecto B4X

1. **Ctrl+Shift+P → B4X Companion: Open B4X Project**
2. Selecciona el archivo `.b4j` (o `.b4a`) de tu proyecto.

Al abrirlo deberías ver en la barra de estado de B4X: el proyecto cargado, módulos
indexados y el LSP arrancando. Puedes comprobar el estado con:

- **B4X Companion: Show Status Summary**

---

## 5. Compilar y ejecutar (B4J)

**Ctrl+Shift+P → B4X Companion: Build & Install Project (B4A / B4J)**

Con `wine.enabled = true`, en Linux la extensión:

1. Convierte las rutas del proyecto de host a Windows con `winepath`.
2. Ejecuta `B4JBuilder.exe` bajo `wine` con el `WINEPREFIX` configurado.
3. Si `b4jRunAfterBuild` está activo, lanza el `.jar` generado con `java`.

El jar resultante aparece en `Objects/` dentro del proyecto.

> **B4A** bajo Wine aún no está soportado por esta versión del fork
> (el build/install de B4A depende de herramientas adicionales).

---

## 6. Verificar que todo funciona

| Comprobación | Cómo |
|---|---|
| INI detectado | Status summary muestra el INI cargado |
| Librerías XML cargadas | IntelliSense ofrece clases de `jCore`, `jServer`, etc. |
| LSP activo | Hover, autocompletado y go-to-definition sobre código B4X |
| Build B4J | Aparece `Objects/<Nombre>.jar` tras compilar |

Comando de diagnóstico completo:

- **B4X Companion: Run All Diagnostics** (vuelca estado, stores y resolución a JSON).

---

## 7. Solución de problemas

### "command not found" al abrir un proyecto
Recarga la ventana (**Developer: Reload Window**) tras instalar el `.vsix`.

### El LSP no arranca / no hay IntelliSense
- Confirma `wine.enabled = true` y que `wine.prefix` apunta al prefix correcto.
- Verifica que `b4xV5.ini` existe en la ruta configurada.
- Revisa la salida de **Run All Diagnostics**.

### Las clases de una librería no aparecen
B4X distingue mayúsculas/minúsculas en los nombres de archivo de librerías.
Esta versión ya hace búsqueda insensible a mayúsculas, pero si falta alguna,
comprueba que el XML de la librería esté en la carpeta `Libraries` del INI
o en la carpeta de librerías adicionales.

### El build falla con error de rutas
Asegúrate de que `winepath -w "<ruta-del-proyecto>"` funciona en tu terminal
con el `WINEPREFIX` correcto:

```bash
WINEPREFIX=/home/usuario/.wine_b4x winepath -w "/ruta/al/proyecto"
```

### El jar no se ejecuta tras el build
- Comprueba que `java -version` funciona.
- Si usas un JDK concreto, pon su ruta en `b4jJavaPath`
  (p. ej. `/usr/lib/jvm/java-11-openjdk/bin/java`).

### B4A / dispositivos / emulador
El build/install de B4A bajo Wine, así como los scripts de captura de pantalla
y emulador, **no están soportados** en esta versión Linux del fork.
