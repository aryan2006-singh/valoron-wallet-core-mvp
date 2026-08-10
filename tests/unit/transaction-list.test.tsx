import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransactionList } from '@/components/wallet/transaction-list'

describe('TransactionList', () => {
  it('shows an empty state with no transactions', () => {
    render(<TransactionList transactions={[]} />)
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })

  it('renders a credit with a plus sign and a debit with a minus sign', () => {
    render(
      <TransactionList
        transactions={[
          {
            id: 't1',
            type: 'deposit',
            status: 'completed',
            amountCents: 2000,
            direction: 'credit',
            createdAt: new Date().toISOString(),
          },
          {
            id: 't2',
            type: 'withdrawal',
            status: 'pending',
            amountCents: 500,
            direction: 'debit',
            createdAt: new Date().toISOString(),
          },
        ]}
      />
    )
    expect(screen.getByText('+$20.00')).toBeInTheDocument()
    expect(screen.getByText('-$5.00')).toBeInTheDocument()
  })
})
