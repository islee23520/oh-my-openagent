import { describe, expect, it } from "bun:test"

import {
  getProviderCapability,
  getProviderFamily,
  isKnownProvider,
} from "./provider-capability-registry"

describe("getProviderCapability", () => {
  it("returns anthropic family for anthropic provider", () => {
    // when
    const capability = getProviderCapability("anthropic")

    // then
    expect(capability.family).toBe("anthropic")
    expect(capability.contextLimitFallback).toBe(200_000)
    expect(capability.supportsExplicitContextConfig).toBe(true)
  })

  it("returns anthropic family for google-vertex-anthropic", () => {
    // when
    const capability = getProviderCapability("google-vertex-anthropic")

    // then
    expect(capability.family).toBe("anthropic")
  })

  it("returns anthropic family for aws-bedrock-anthropic", () => {
    // when
    const capability = getProviderCapability("aws-bedrock-anthropic")

    // then
    expect(capability.family).toBe("anthropic")
  })

  it("returns github-copilot family for github-copilot provider", () => {
    // when
    const capability = getProviderCapability("github-copilot")

    // then
    expect(capability.family).toBe("github-copilot")
    expect(capability.contextLimitFallback).toBe(64_000)
    expect(capability.supportsExplicitContextConfig).toBe(true)
  })

  it("returns github-copilot family for copilot alias", () => {
    // when
    const capability = getProviderCapability("copilot")

    // then
    expect(capability.family).toBe("github-copilot")
  })

  it("is case-insensitive for provider IDs", () => {
    // when
    const capability = getProviderCapability("GitHub-Copilot")

    // then
    expect(capability.family).toBe("github-copilot")
  })

  it("returns unknown family for unrecognized providers", () => {
    // when
    const capability = getProviderCapability("openai")

    // then
    expect(capability.family).toBe("unknown")
    expect(capability.contextLimitFallback).toBe(32_000)
    expect(capability.supportsExplicitContextConfig).toBe(false)
  })
})

describe("getProviderFamily", () => {
  it("returns anthropic for anthropic provider", () => {
    expect(getProviderFamily("anthropic")).toBe("anthropic")
  })

  it("returns github-copilot for github-copilot provider", () => {
    expect(getProviderFamily("github-copilot")).toBe("github-copilot")
  })

  it("returns unknown for unrecognized provider", () => {
    expect(getProviderFamily("some-unknown-provider")).toBe("unknown")
  })
})

describe("isKnownProvider", () => {
  it("returns true for anthropic", () => {
    expect(isKnownProvider("anthropic")).toBe(true)
  })

  it("returns true for github-copilot", () => {
    expect(isKnownProvider("github-copilot")).toBe(true)
  })

  it("returns false for unknown providers", () => {
    expect(isKnownProvider("some-random-provider")).toBe(false)
  })
})
