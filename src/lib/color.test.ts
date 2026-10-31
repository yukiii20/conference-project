import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFERENCE_COLOR, getAccessibleTextColor, isValidHexColor, resolveConferenceBrand } from './color'

describe('isValidHexColor', () => {
  it('accepts only #rrggbb', () => {
    expect(isValidHexColor('#1a2B3c')).toBe(true)
    expect(isValidHexColor('#fff')).toBe(false)
    expect(isValidHexColor('1a2b3c')).toBe(false)
    expect(isValidHexColor('red')).toBe(false)
    expect(isValidHexColor('#1a2b3c; background:url(x)')).toBe(false)
  })
})

describe('resolveConferenceBrand', () => {
  it('uses a valid conference colour', () => {
    const brand = resolveConferenceBrand('#0B6E4F')
    expect(brand.isCustom).toBe(true)
    expect(brand.color).toBe('#0b6e4f')
    expect(brand.hover).not.toBe(brand.color)
    expect(brand.active).not.toBe(brand.hover)
  })

  it('falls back to the platform default for missing or invalid colours', () => {
    for (const value of [null, undefined, '', '   ', 'blue', '#12', 'url(javascript:alert(1))', '#zzzzzz']) {
      const brand = resolveConferenceBrand(value)
      expect(brand.isCustom).toBe(false)
      expect(brand.color).toBe(DEFAULT_CONFERENCE_COLOR.toLowerCase())
    }
  })

  it('trims whitespace around a valid colour', () => {
    expect(resolveConferenceBrand('  #123456 ').color).toBe('#123456')
  })

  it('picks readable button text: white on dark colours, dark on light colours', () => {
    expect(resolveConferenceBrand('#101c32').onColor).toBe('#ffffff')
    expect(resolveConferenceBrand('#ffe066').onColor).toBe('#172033')
    expect(resolveConferenceBrand('#ffffff').onColor).toBe('#172033')
    expect(getAccessibleTextColor('#000000')).toBe('#ffffff')
  })

  it('darkens light colours for link text so it stays readable on white', () => {
    const light = resolveConferenceBrand('#ffe066')
    expect(light.text).not.toBe(light.color)
    expect(getAccessibleTextColor(light.text)).toBe('#ffffff')
    const dark = resolveConferenceBrand('#101c32')
    expect(dark.text).toBe('#101c32')
  })
})
