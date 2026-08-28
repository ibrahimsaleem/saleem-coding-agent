# Saleem Harness

A personalized coding-agent CLI (`saleem`) with a preventive tool-call safety guard active by default — see `packages/guard/tool-guard-saleem/` and `packages/client/ui-brand-saleem/`.

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

Currently in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

Build from source, then run alongside (not replacing) any other harness install on the same machine:

```sh
pnpm install
pnpm run build
cd apps/cli
npm link
```

```sh
saleem web
```

Starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. Pass `--no-open` to run the server without opening a browser.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
