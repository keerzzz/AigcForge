// @ts-nocheck
import { AccordionV2 } from "../v2/components/accordion-v2"
import * as mod from "./sticky-accordion-header"

const docs = `### Overview
Sticky accordion header wrapper for persistent section labels.

Use only inside \`Accordion.Item\` with \`Accordion.Trigger\`.

### API
- Accepts standard header props and children.

### Variants and states
- Inherits accordion states.

### Behavior
- Renders inside an Accordion item header.

### Accessibility
- TODO: confirm semantics from Accordion.Header usage.

### Theming/tokens
- Uses \`data-component="sticky-accordion-header"\`.

`

export default {
  title: "UI/StickyAccordionHeader",
  id: "components-sticky-accordion-header",
  component: mod.StickyAccordionHeader,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <AccordionV2 value="first">
      <AccordionV2.Item value="first">
        <mod.StickyAccordionHeader>
          <AccordionV2.Trigger>Sticky header</AccordionV2.Trigger>
        </mod.StickyAccordionHeader>
        <AccordionV2.Content>
          <div style={{ color: "var(--text-weak)", padding: "8px 0" }}>Accordion content.</div>
        </AccordionV2.Content>
      </AccordionV2.Item>
    </AccordionV2>
  ),
}
