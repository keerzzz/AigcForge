import type { HomeController } from "./model"
import { CustomWorkspace } from "./custom/workspace"

export type { CustomOwner as Owner } from "./custom/shared"

export function CustomComposition(props: { home: HomeController }) {
  return <CustomWorkspace home={props.home} />
}
