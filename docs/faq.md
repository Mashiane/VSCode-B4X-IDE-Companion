# FAQ

Q: The extension doesn't show completions.
A: Ensure the workspace contains `.bas` or `.b4x` files and that indexing has completed. Check the `Output` panel for `B4X IntelliSense` logs.

Q: How do I re-generate the API index?
A: Run `npm run build:index` to regenerate `data/b4x-api-index.json` from `b4a_libraries.txt`.

Q: How do I report bugs?
A: Open an issue on the repository and include reproduction steps and logs from the `Output` panel.
