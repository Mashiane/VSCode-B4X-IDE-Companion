# Contributing to B4X IntelliSense

Thanks for your interest in contributing! Please follow these guidelines to make the review process smooth.

- Fork the repository and create a topic branch for your work.
- Keep changes small and focused; open one PR per feature/bugfix.
- Run the TypeScript compiler and tests before submitting:

```bash
npm install
npm run compile
npm run test
```

- Follow the code style in existing files (no trailing whitespace; use single indents consistent with TypeScript defaults).
- Add unit tests for substantial new logic under `server/indexer/tests` or `test` where appropriate.
- Update `CHANGELOG.md` with a short note under the `Unreleased` section describing the change.
- Use a clear PR title and include reproduction steps or test instructions.

Maintainers will review and provide feedback — thank you!
