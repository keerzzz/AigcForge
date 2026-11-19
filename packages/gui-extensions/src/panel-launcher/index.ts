import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  id: "panel-launcher",
  i18n: { en, zh: () => import("./i18n/zh") },
})
