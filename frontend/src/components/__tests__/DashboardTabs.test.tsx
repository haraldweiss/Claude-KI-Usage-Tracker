import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DashboardTabs from '../DashboardTabs';

describe('DashboardTabs', () => {
  it('renders two tabs: Übersicht and Modelle', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    expect(screen.getByText('Übersicht')).toBeInTheDocument();
    expect(screen.getByText('Modelle')).toBeInTheDocument();
  });

  it('calls onTabChange with "overview" when Übersicht is clicked', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="models"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByText('Übersicht');
    fireEvent.click(uebersichtTab);

    expect(handleTabChange).toHaveBeenCalledWith('overview');
  });

  it('calls onTabChange with "models" when Modelle is clicked', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByText('Modelle');
    fireEvent.click(modelleTab);

    expect(handleTabChange).toHaveBeenCalledWith('models');
  });

  it('highlights the active tab', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByText('Übersicht').closest('button');
    expect(uebersichtTab).toHaveClass('text-gray-900', 'border-b-2', 'border-gray-900');
  });

  it('shows inactive tab styling for non-active tabs', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByText('Modelle').closest('button');
    expect(modelleTab).toHaveClass('text-gray-600');
    expect(modelleTab).not.toHaveClass('border-b-2');
  });

  it('has semantic ARIA attributes for accessibility', () => {
    const handleTabChange = vi.fn();
    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'Dashboard navigation');

    const uebersichtTab = screen.getByRole('tab', { name: 'Übersicht' });
    expect(uebersichtTab).toHaveAttribute('aria-selected', 'true');
    expect(uebersichtTab).toHaveAttribute('aria-controls', 'overview-panel');
    expect(uebersichtTab).toHaveAttribute('tabIndex', '0');

    const modelleTab = screen.getByRole('tab', { name: 'Modelle' });
    expect(modelleTab).toHaveAttribute('aria-selected', 'false');
    expect(modelleTab).toHaveAttribute('aria-controls', 'models-panel');
    expect(modelleTab).toHaveAttribute('tabIndex', '-1');
  });

  it('supports keyboard navigation with ArrowRight', async () => {
    const handleTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByRole('tab', { name: 'Übersicht' });
    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(handleTabChange).toHaveBeenCalledWith('models');
  });

  it('supports keyboard navigation with ArrowLeft', async () => {
    const handleTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardTabs
        activeTab="models"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByRole('tab', { name: 'Modelle' });
    await user.click(modelleTab);
    await user.keyboard('{ArrowLeft}');

    expect(handleTabChange).toHaveBeenCalledWith('overview');
  });

  it('supports keyboard navigation with Home key', async () => {
    const handleTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardTabs
        activeTab="models"
        onTabChange={handleTabChange}
      />
    );

    const modelleTab = screen.getByRole('tab', { name: 'Modelle' });
    await user.click(modelleTab);
    await user.keyboard('{Home}');

    expect(handleTabChange).toHaveBeenCalledWith('overview');
  });

  it('supports keyboard navigation with End key', async () => {
    const handleTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const uebersichtTab = screen.getByRole('tab', { name: 'Übersicht' });
    await user.click(uebersichtTab);
    await user.keyboard('{End}');

    // 'combined' is now the last tab in the strip
    expect(handleTabChange).toHaveBeenCalledWith('combined');
  });

  it('renders the combined cost tab and selects it on click', async () => {
    const handleTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardTabs
        activeTab="overview"
        onTabChange={handleTabChange}
      />
    );

    const combinedTab = screen.getByRole('tab', { name: 'Gesamtkosten' });
    expect(combinedTab).toBeInTheDocument();

    await user.click(combinedTab);
    expect(handleTabChange).toHaveBeenCalledWith('combined');
  });
});
