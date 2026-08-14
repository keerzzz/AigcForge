# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
- 本包经相对路径 `../aigcfroge/dist/node` 隐式依赖 `packages/aigcfroge`（sidecar 后端），严禁删除该包。
