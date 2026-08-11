import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BalanceCard } from '@/components/wallet/balance-card'

describe('BalanceCard', () => {
  it('displays the formatted balance', () => {
    render(<BalanceCard balanceCents={123456} />)
    expect(screen.getByTestId('balance-amount')).toHaveTextContent('$1,234.56')
  })
})
