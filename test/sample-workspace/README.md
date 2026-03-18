# Sample Workspace

Open this folder in the Extension Host window to test workspace-aware IntelliSense.

Files included:

- `Main.bas`: consumer file that references the other modules
- `UserSession.bas`: `Type=Class` module
- `AppActions.bas`: `Type=StaticCode` module

Suggested checks:

- `Session.` should show only public class members
- `LocalSession.` should show only public class members
- `AppActions.` should show only public static members
- Go to definition on `UserSession`, `AppActions`, and their public members should jump to the correct files
