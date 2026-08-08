import { describe, expect, test } from "bun:test"
import { CHART_LIBS, resolveLibs } from "./chart-libs"

describe("resolveLibs (D3 Inline Script Injection)", () => {
  test("inlines vis-network when the html uses the vis global API", () => {
    const html = '<script>new vis.Network(document.getElementById("topo"), {}, {});</script>'
    expect(resolveLibs(html)).toEqual([CHART_LIBS["vis-network"]])
  })

  test("inlines chart.js when the html uses the Chart global", () => {
    const html = '<script>new Chart(document.getElementById("c"), { data: {} });</script>'
    expect(resolveLibs(html)).toEqual([CHART_LIBS["chart.js"]])
  })

  test("inlines both when both globals are used", () => {
    const html = '<script>vis.Network(); new Chart();</script>'
    expect(resolveLibs(html)).toEqual([CHART_LIBS["vis-network"], CHART_LIBS["chart.js"]])
  })

  test("returns nothing for plain html", () => {
    expect(resolveLibs("<div>hi</div>")).toEqual([])
  })

  test("lib sources are self-contained UMD bundles (no import statements)", () => {
    for (const source of Object.values(CHART_LIBS)) {
      expect(source.length).toBeGreaterThan(1000)
      expect(source).not.toMatch(/^\s*import\s/m)
    }
  })
})
