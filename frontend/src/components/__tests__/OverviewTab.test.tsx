// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OverviewTab from '../OverviewTab';

describe('OverviewTab', () => {
  it('renders without crashing', () => {
    render(<OverviewTab />);
    expect(screen.getByText(/Lade Übersicht/i)).toBeInTheDocument();
  });
});
