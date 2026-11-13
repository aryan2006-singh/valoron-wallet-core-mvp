import { describe, it, expect } from 'vitest'
import { categorizeNote, isCategory } from '@/lib/ai/categories'

describe('categorizeNote', () => {
  it.each([
    ['Pizza dinner', 'food'],
    ['monthly rent', 'rent'],
    ['Uber home', 'transport'],
    ['wifi bill', 'bills'],
    ['veggies from the supermarket', 'groceries'],
    ['Goa trip', 'travel'],
    ['birthday gift', 'gifts'],
    ['split for netflix', 'entertainment'],
  ])('%s -> %s', (note, category) => {
    expect(categorizeNote(note)).toBe(category)
  })

  it('falls back to other for unknown text or no note', () => {
    expect(categorizeNote('asdf')).toBe('other')
    expect(categorizeNote('')).toBe('other')
    expect(categorizeNote(null)).toBe('other')
  })
})

describe('isCategory', () => {
  it('accepts only known categories', () => {
    expect(isCategory('food')).toBe(true)
    expect(isCategory('crypto')).toBe(false)
    expect(isCategory(null)).toBe(false)
  })
})
