# Manual Release

## 1. Verify local state and npm access

```bash
git status --short --branch
npm whoami --registry https://registry.npmjs.org/
npm view aiprofile version --registry https://registry.npmjs.org/
```

For the first public release, `npm view` should return a 404 because the package name has not been claimed yet.

## 2. Run release gates

```bash
npm run build
npm run lint
npm run format:check
npm test
```

## 3. Choose and apply a version bump

```bash
npm version patch
npm version minor
npm version major
```

AIProfile reads user-facing version metadata from `package.json` at runtime.

For the initial package-name reservation release, use the existing `0.1.0` version and skip this step.

## 4. Validate the npm package

```bash
npm publish --dry-run --registry https://registry.npmjs.org/
```

Confirm the tarball contains `dist/`, `README.md`, `config.yaml`, `LICENSE`, and `package.json`, and does not contain local `models/`, `memory/`, or `node_modules/` directories.

## 5. Publish to npm

```bash
npm publish --registry https://registry.npmjs.org/
```

## 6. Verify the published version

```bash
VERSION=$(node -p "require('./package.json').version")
npm view "aiprofile@$VERSION" version --registry https://registry.npmjs.org/
npm view aiprofile dist-tags --registry https://registry.npmjs.org/
```

Confirm `latest` points to the version you just published.

## 7. Push the version commit and tag

```bash
git push
git push --tags
```

## 8. Create a GitHub release

Create a GitHub release manually:

- Use the tag `v$VERSION`.
- Include release notes with usage notes and any breaking changes.

## 9. Smoke test

Smoke test from source or npm:

```bash
npm install --ignore-scripts=false
npm run setup-model
npm run build
npm start
npx --yes --ignore-scripts=false aiprofile --help
```

Confirm the MCP endpoint works at `http://localhost:3000/mcp` with MCP Inspector or another MCP client.
