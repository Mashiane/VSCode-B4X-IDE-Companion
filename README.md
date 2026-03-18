# b4x-intellisense

[![CI](https://github.com/your-username/b4x-vscode-intellisense/actions/workflows/publish.yml/badge.svg)](https://github.com/your-username/b4x-vscode-intellisense/actions)

## Purpose

`b4x-intellisense` is a direct VS Code extension for B4X source files.

The goal of this project is to provide a first practical IntelliSense layer for `.bas` and `.b4x` files without introducing a language server yet. The extension reads B4A / B4X API metadata from `b4a_libraries.txt`, converts it into a machine-readable JSON index, and uses that index for completions, hover, and basic signature help.

## What the first version supports

The current version supports:

- Custom `b4x` language registration for `.bas` and `.b4x`
- Language configuration for comments, brackets, and auto-closing pairs
- TextMate grammar for basic syntax highlighting
- Practical B4X snippets
- API index generation from `b4a_libraries.txt`
- Class completions
- Method and property completions
- Member completions after `.` using basic variable type inference
- Local symbol completions from the current file
- Workspace class completions for sibling `.bas` / `.b4x` class files declared as `Type=Class`
- Workspace static module completions for sibling `.bas` / `.b4x` files declared as `Type=StaticCode`
- External XML library completions, hover, signature help, and definition support from platform folders discovered through B4X ini files
- `.b4a` project-file filtering for allowed libraries and modules
- Go to definition for workspace class/static module names and their public members
- Hover for classes, methods, and properties
- Basic signature help for member method calls

## Project structure

```text
src/
	extension.ts           VS Code activation, completions, hover, signature help
	apiIndex.ts            API index loading and lookup helpers
	platformConfig.ts      VS Code settings and platform ini path access
	platformIni.ts         Ini parsing and external folder discovery for B4X platforms
	types.ts               Shared TypeScript types for the index
	b4xDocParser.ts        Parsing helpers for API docs and editor context
	b4xTypeInference.ts    Simple variable type inference from the current file
	b4xLocalSymbols.ts     Local symbol scanning for subs, types, and variables

scripts/
	buildApiIndex.ts       Reads b4a_libraries.txt and writes data/b4x-api-index.json

data/
	b4x-api-index.json     Generated API index used by the extension

syntaxes/
	b4x.tmLanguage.json    TextMate grammar for syntax highlighting

snippets/
	b4x.json               Editor snippets for common B4X constructs

language-configuration.json
package.json
tsconfig.json
README.md
```

## How the API index is built

The file `b4a_libraries.txt` is the source of truth for the B4X / B4A API metadata.

The generator in `scripts/buildApiIndex.ts` reads that file, parses sections such as:

- `''' LIBRARY: Name (vX)`
- `''' === CLASS: Name ===`
- `[Met] ...`
- `[Prop]`, `[Prop:R]`, `[Prop:W]`
- documentation lines beginning with `'''`

It then writes a machine-readable file to:

```text
data/b4x-api-index.json
```

That JSON file is loaded by the extension at activation time and used for IntelliSense features.

## Setup

Install dependencies:

```bash
npm install
```

Generate the API index:

```bash
npm run build:index
```

Compile the extension:

```bash
npm run compile
```

Run the extension in VS Code:

1. Open the project in VS Code.
2. Press `F5`.
3. In the Extension Host window, open a `.bas` or `.b4x` file.

You can also use the File menu command `Open B4A Project...` to pick a `.b4a` file, or right-click a `.b4a` file in the Explorer and choose the same action. The extension will add that project's root folder to the current workspace, open the selected `.b4a` file, and switch IntelliSense to that project context.

## Platform settings

The extension now exposes configurable settings for platform ini file paths:

- `b4xIntellisense.b4aIniPath`
- `b4xIntellisense.b4iIniPath`
- `b4xIntellisense.b4jIniPath`
- `b4xIntellisense.b4rIniPath`

Default value:

```text
C:\Users\User\AppData\Roaming\Anywhere Software\Basic4android\b4xV5.ini
```

This is the path that future platform-aware loading will use for B4A-specific settings such as shared folders, libraries, and additional libraries. If that file location changes later, update the setting in VS Code instead of changing the extension code.

The ini parser currently looks for these keys across platforms:

- `LibrariesFolder`
- `AdditionalLibrariesFolder`
- `SharedModulesFolder`

For now, discovery behaves like this across all configured platform folders:

- scans `.bas` and `.b4x` source modules
- scans `.xml` library descriptor files
- scans `.b4xlib` packages

Currently, external source modules and XML library descriptors are loaded into live IntelliSense. `.b4xlib` packages are discovered but not parsed yet.

When a `.b4a` project file exists in the workspace, it becomes the allow-list for IntelliSense:

- the active editor determines which `.b4a` project configuration is used
- opening a `.b4a` file directly switches IntelliSense to that project context
- opening a `.bas` or `.b4x` file switches to the best matching `.b4a` project that includes that file or shares its project root
- only `LibraryN=` entries are exposed from API-index and XML-backed libraries
- only `ModuleN=` entries are indexed as workspace modules or external modules
- bare module names are resolved relative to the `.b4a` project folder
- `|relative|...` module entries are resolved relative to the ini-configured `SharedModulesFolder`
- `|absolute|...` module entries are treated as literal filesystem paths
- `.b4a` files can live in nested platform folders such as `B4A/1.b4a`; they do not need to sit at the workspace root
- relative shared-module paths can resolve outside the shared folder itself, for example `|relative|..\AccountView`
- changes to the `.b4a` file are watched and applied live

Jar parsing is intentionally not enabled yet.

## Example usage

Example B4X code:

```b4x
Dim Access As Accessibility
Access.
```

Workspace class example:

```b4x
Dim Widget As MyWidget
Widget.
```

Workspace static module example:

```b4x
Home.DoSomething(x)
```

The extension will:

- infer that `Access` is of type `Accessibility`
- look up `Accessibility` in the generated API index
- return only the methods and properties that belong to that class after `.`
- infer that `Widget` is a workspace class when `MyWidget.bas` exists in the workspace, is declared as `Type=Class`, and contains `Class_Globals`
- resolve `Home` as a workspace static module when `Home.bas` is declared as `Type=StaticCode` and contains `Process_Globals`

When the same module name exists in both the opened project and an external platform folder, the opened project file takes precedence.

When an external XML class name overlaps with a workspace or external source module name, the source module still wins. XML-backed classes are treated as a lower-precedence fallback ahead of the generated API index.

## Known limitations

This is intentionally a lightweight v1 implementation.

Known limitations:

- No language server yet
- Type inference is still basic and mostly based on straightforward declarations
- Workspace-wide project understanding is not implemented
- Workspace class discovery currently relies on files declared as `Type=Class` that include `Sub Class_Globals`
- Workspace static modules rely on files declared as `Type=StaticCode` that include `Sub Process_Globals`
- Only `Public` members from `Class_Globals` and `Public Sub` methods are exposed across files
- Only `Public` members from `Process_Globals` and `Public Sub` methods are exposed across static modules
- Symbol resolution is centered on the current file, workspace/external source modules, external XML descriptors, and the generated API index
- Go to definition and find references are not implemented yet
- Some B4X language patterns and edge cases are not fully parsed

## Planned next steps

Planned improvements include:

- Go to definition
- Find references
- Workspace indexing
- Smarter cross-file symbol understanding
- Possible future migration to a language server when the direct extension approach reaches its limits
