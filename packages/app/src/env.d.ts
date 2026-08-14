/// <reference types="vite/client" />

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: any
    }
  }
}

export {}
