/**
 * Spending categories a transfer can carry. Must match the CHECK
 * constraint on transactions.category
 * (apps/api/supabase/migrations/20261113080000_transfer_notes_and_insights.sql).
 */
export const CATEGORIES = [
  'food',
  'groceries',
  'rent',
  'bills',
  'transport',
  'shopping',
  'entertainment',
  'travel',
  'health',
  'gifts',
  'friends',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

// Ordered: the first category with a matching keyword wins, so the more
// specific buckets (groceries, rent) sit above the broad ones (food, bills).
const KEYWORDS: [Category, string[]][] = [
  ['groceries', ['grocer', 'supermarket', 'vegetable', 'veggies', 'milk', 'kirana', 'mart']],
  ['rent', ['rent', 'landlord', 'lease', 'flat', 'apartment', 'pg ', 'hostel']],
  ['bills', ['bill', 'electric', 'water', 'wifi', 'internet', 'phone', 'recharge', 'gas', 'utility', 'subscription']],
  ['food', ['food', 'dinner', 'lunch', 'breakfast', 'pizza', 'burger', 'coffee', 'cafe', 'restaurant', 'snack', 'chai', 'biryani', 'swiggy', 'zomato']],
  ['transport', ['uber', 'ola', 'cab', 'taxi', 'fuel', 'petrol', 'diesel', 'metro', 'bus', 'train ticket', 'parking', 'auto']],
  ['travel', ['trip', 'flight', 'hotel', 'travel', 'vacation', 'holiday', 'airbnb', 'goa']],
  ['entertainment', ['movie', 'cinema', 'netflix', 'spotify', 'concert', 'game', 'party', 'drinks', 'club']],
  ['shopping', ['shopping', 'clothes', 'shoes', 'amazon', 'flipkart', 'order', 'gadget']],
  ['health', ['doctor', 'medicine', 'pharmacy', 'hospital', 'gym', 'clinic', 'dentist']],
  ['gifts', ['gift', 'birthday', 'wedding', 'anniversary', 'present']],
  ['friends', ['split', 'share', 'owe', 'payback', 'pay back', 'iou', 'loan']],
]

/**
 * Picks a category from a transfer note with plain keyword matching. It is
 * deliberately not a model call: it runs inline on the Send path, so it
 * must be instant, free and impossible to fail. A note with no match (or
 * no note at all) is 'other'.
 */
export function categorizeNote(note: string | null | undefined): Category {
  if (!note) return 'other'
  const text = ` ${note.toLowerCase()} `
  for (const [category, words] of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return category
  }
  return 'other'
}
