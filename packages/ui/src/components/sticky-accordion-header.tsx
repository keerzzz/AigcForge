import { AccordionV2 } from "../v2/components/accordion-v2"
import { ParentProps } from "solid-js"

export function StickyAccordionHeader(
  props: ParentProps<{ class?: string; classList?: Record<string, boolean | undefined> }>,
) {
  return (
    <AccordionV2.Header
      data-component="sticky-accordion-header"
      classList={{
        ...props.classList,
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.children}
    </AccordionV2.Header>
  )
}
