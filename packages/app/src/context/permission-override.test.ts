import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// S12 shared permission control surface (plan §6.8): the break-glass lease
// entry and the permission-tier mutation entry must share ONE owner — no
// duplicated timer, state, or permission computation. There is no DOM-render
// harness for Solid components in this package, so the contract is asserted at
// the wiring level, which is exactly the relation that decides it: which module
// calls the override endpoints and the tier mutation endpoint.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("shared permission control surface", () => {
  test("the permission owner carries the break-glass lease endpoints", () => {
    const owner = read("permission.tsx")
    expect(owner).toContain("client.permission.override.get")
    expect(owner).toContain("client.permission.override.put")
    expect(owner).toContain("client.permission.override.delete")
  })

  test("the permission owner carries the tier mutation endpoint", () => {
    const owner = read("permission.tsx")
    expect(owner).toContain("client.session.update")
    expect(owner).toContain("permissionTier")
  })

  test("the composer region consumes the owner instead of calling the endpoints itself", () => {
    const composer = read("../pages/session/composer/session-composer-region.tsx")
    expect(composer).not.toContain("client.permission.override")
    expect(composer).not.toContain("client.session.update")
  })

  test("the composer region exposes the tier mutation entry through the owner", () => {
    const composer = read("../pages/session/composer/session-composer-region.tsx")
    expect(composer).toContain("permission.setPermissionTier")
    expect(composer).toContain('data-slot="permission-tier-control"')
  })

  test("the composer region consumes the owner for the break-glass lease", () => {
    const composer = read("../pages/session/composer/session-composer-region.tsx")
    expect(composer).toContain("permission.refreshOverride")
    expect(composer).toContain("permission.updateOverride")
    expect(composer).toContain("permission.overrideEnabled")
  })
})
